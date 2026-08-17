import { request } from "./cloud-api.js";
import { $, escapeHtml, euro, NO_COVER, usableCoverUrl } from "./ui-utils.js";
import { decodeBarcodeFile, startLiveScanner, stopLiveScanner } from "./scanner.js";
import { renderMarketplaceResults, renderWorkspace, savedMarketplaceResults } from "./marketplace-ui.js";
import { parseBatchIsbns, runPool } from "./batch-utils.js";

const state = { book: null, books: [], marketplaceResults: null };
const BATCH_MAX_BOOKS = 10;
const BATCH_METADATA_CONCURRENCY = 4;
const BATCH_PRICE_CONCURRENCY = 2;
const batchEntries = new Map();
const batchPriceQueue = [];
let batchPriceActive = 0;
let batchRunning = false;
let booksLoadSequence = 0;

async function requireLogin() {
  const session = await request("/api/session");
  if (!session.authenticated) {
    $("#loginStatus").textContent = session.configured ? "" : "Configura APP_USERNAME e APP_PASSWORD nel file .env.";
    $("#loginDialog").showModal();
    return false;
  }
  return true;
}

function renderBookList() {
  const query = $("#bookSearch").value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it").trim();
  const books = state.books.filter(book => !query || `${book.title} ${book.authors} ${book.isbn}`.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it").includes(query));
  $("#bookCount").textContent = query ? `${books.length} di ${state.books.length}` : `${state.books.length} ${state.books.length === 1 ? "libro" : "libri"}`;
  $("#bookList").innerHTML = books.length ? books.map(book => `<button class="book-row" data-id="${book.id}"><img src="${escapeHtml(usableCoverUrl(book.cover_url) || NO_COVER)}" alt="Copertina di ${escapeHtml(book.title)}"><span class="book-row-copy"><b>${escapeHtml(book.title)}</b><small>${escapeHtml(book.authors || "Autore non indicato")}</small><em>ISBN ${escapeHtml(book.isbn)}</em></span><span class="book-row-price"><small>Prezzo consigliato</small><strong>${euro(book.analysis?.recommendedPrice)}</strong></span></button>`).join("") : `<p class="empty">${query ? "Nessun libro corrisponde alla ricerca." : "Nessun libro ancora valutato."}</p>`;
  document.querySelectorAll(".book-row img").forEach(image => image.addEventListener("error", () => { image.src = NO_COVER; }, { once:true }));
  document.querySelectorAll(".book-row").forEach(button => button.addEventListener("click", () => openBook(button.dataset.id)));
}

async function loadBooks() {
  const sequence = ++booksLoadSequence;
  const books = await request("/api/books");
  if (sequence !== booksLoadSequence) return false;
  state.books = books;
  renderBookList();
  return true;
}

function renderBatchEntry(entry) {
  let row = document.querySelector(`.batch-item[data-isbn="${CSS.escape(entry.isbn)}"]`);
  if (!row) {
    row = document.createElement("article");
    row.className = "batch-item";
    row.dataset.isbn = entry.isbn;
    row.innerHTML = `<div><strong>${escapeHtml(entry.isbn)}</strong><small></small></div><span class="batch-stage"></span>`;
    $("#batchResults").append(row);
  }
  row.className = `batch-item ${entry.className || ""}`;
  row.querySelector("strong").textContent = entry.title || entry.isbn;
  row.querySelector("small").textContent = entry.title ? `${entry.authors || "Autore non indicato"} · ISBN ${entry.isbn}` : entry.detail || "";
  row.querySelector(".batch-stage").textContent = entry.stage || "In attesa";
  if (entry.book?.id) {
    row.classList.add("is-clickable");
    row.setAttribute("role", "link");
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-label", `Apri ${entry.title || entry.isbn} in una nuova scheda`);
    row.onclick = () => {
      const url = new URL(location.href);
      url.searchParams.set("book", entry.book.id);
      window.open(url, "_blank", "noopener");
    };
    row.onkeydown = event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); row.click(); }
    };
  }
}

function updateBatchEntry(isbn, changes) {
  const entry = batchEntries.get(isbn);
  if (!entry) return null;
  Object.assign(entry, changes);
  renderBatchEntry(entry);
  return entry;
}

function startExtensionForBook(book) {
  const requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  return new Promise(resolve => {
    const timeout = setTimeout(() => { window.removeEventListener("message", receive); resolve(false); }, 1400);
    function receive(event) {
      const data = event.data;
      if (event.origin !== location.origin || data?.source !== "prezzolibri-extension" || data.type !== "ACCEPTED" || data.requestId !== requestId) return;
      clearTimeout(timeout); window.removeEventListener("message", receive); resolve(Boolean(data.ok));
    }
    window.addEventListener("message", receive);
    window.postMessage({ source:"prezzolibri-app", type:"QUEUE_EXTENSION_BOOK", requestId, book:{ isbn:book.isbn, title:book.title, authors:book.authors || "" } }, location.origin);
  });
}

function releaseBatchPriceSlot(entry) {
  if (!entry?.priceSlot) return;
  entry.priceSlot = false;
  clearTimeout(entry.priceTimeout);
  batchPriceActive = Math.max(0, batchPriceActive - 1);
  pumpBatchPriceQueue();
  if (!batchPriceActive && !batchPriceQueue.length && !batchRunning) {
    $("#batchStart").disabled = false;
    const completed = [...batchEntries.values()].filter(item => item.className === "is-done").length;
    const errors = [...batchEntries.values()].filter(item => item.className === "is-error").length;
    $("#batchStatus").textContent = `Ricerca multipla conclusa: ${completed} completati${errors ? `, ${errors} da controllare` : ""}.`;
  }
}

async function runServerBatchPrice(entry) {
  try {
    updateBatchEntry(entry.isbn, { stage:"Ricerca prezzi dal server…", className:"is-running" });
    await request(`/api/books/${entry.book.id}/search-marketplaces`, { method:"POST", body:"{}" });
    updateBatchEntry(entry.isbn, { stage:"Valutazione completata", className:"is-done" });
  } catch (error) {
    updateBatchEntry(entry.isbn, { stage:`Prezzi non disponibili: ${error.message}`, className:"is-error" });
  } finally {
    releaseBatchPriceSlot(entry);
    loadBooks().catch(() => {});
  }
}

function pumpBatchPriceQueue() {
  while (batchPriceActive < BATCH_PRICE_CONCURRENCY && batchPriceQueue.length) {
    const entry = batchPriceQueue.shift();
    if (!entry || entry.priceStarted) continue;
    entry.priceStarted = true; entry.priceSlot = true; batchPriceActive += 1;
    updateBatchEntry(entry.isbn, { stage:"Avvio ricerca prezzi…", className:"is-running" });
    startExtensionForBook(entry.book).then(accepted => {
      if (!accepted) return runServerBatchPrice(entry);
      updateBatchEntry(entry.isbn, { stage:"Marketplace in elaborazione…", className:"is-running" });
      entry.priceTimeout = setTimeout(() => {
        updateBatchEntry(entry.isbn, { stage:"Tempo scaduto; puoi riprovare dalla scheda", className:"is-error" });
        releaseBatchPriceSlot(entry);
      }, 6 * 60 * 1000);
    });
  }
}

function queueBatchPrice(entry) {
  batchPriceQueue.push(entry);
  pumpBatchPriceQueue();
}

async function identifyBatchBook(isbn) {
  updateBatchEntry(isbn, { stage:"Cerco titolo ed edizione…", className:"is-running" });
  try {
    const metadata = await request(`/api/isbn/${encodeURIComponent(isbn)}`);
    if (!metadata.title) throw new Error("titolo non trovato");
    const existing = state.books.find(book => book.isbn === isbn);
    const book = existing || await request("/api/books", { method:"POST", body:JSON.stringify({
      isbn:metadata.isbn || isbn, title:metadata.title, authors:metadata.authors || "", publisher:metadata.publisher || "",
      year:metadata.year || "", coverUrl:metadata.coverUrl || "", coverPrice:metadata.coverPrice ?? null, condition:"good", notes:""
    }) });
    const entry = updateBatchEntry(isbn, { book, title:book.title || metadata.title, authors:book.authors || metadata.authors || "", stage:"Identificato · in coda prezzi", className:"is-running" });
    queueBatchPrice(entry);
  } catch (error) {
    updateBatchEntry(isbn, { stage:`Libro non identificato: ${error.message}`, className:"is-error" });
  }
}

function showEditor(metadata) {
  $("#startView").hidden = true; $("#editorView").hidden = false;
  $("#bookId").value = metadata.id || ""; $("#bookIsbn").value = metadata.isbn || ""; $("#title").value = metadata.title || "";
  $("#authors").value = metadata.authors || ""; $("#publisher").value = metadata.publisher || ""; $("#year").value = metadata.year || "";
  $("#coverPrice").value = metadata.cover_price ?? metadata.coverPrice ?? ""; $("#condition").value = metadata.condition || "good"; $("#notes").value = metadata.notes || "";
  $("#cover").src = usableCoverUrl(metadata.cover_url || metadata.coverUrl) || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='340'%3E%3Crect width='100%25' height='100%25' fill='%23e8e1d5'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' fill='%23756f66'%3ENessuna copertina%3C/text%3E%3C/svg%3E";
  $("#workspace").hidden = !metadata.id;
}

async function openBook(id) {
  state.book = await request(`/api/books/${id}`);
  state.marketplaceResults = savedMarketplaceResults(state.book.comparables);
  showEditor(state.book);
  renderWorkspace(state.book, state.marketplaceResults);
  renderMarketplaceResults(state.marketplaceResults);
}

function startExtensionSearch() {
  const requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  return new Promise(resolve => {
    const timeout = setTimeout(() => { window.removeEventListener("message", receive); resolve(false); }, 1000);
    function receive(event) {
      const data = event.data;
      if (event.origin !== location.origin || data?.source !== "prezzolibri-extension" || data.type !== "ACCEPTED" || data.requestId !== requestId) return;
      clearTimeout(timeout); window.removeEventListener("message", receive);
      if (!data.ok && data.error) $("#marketStatus").textContent = data.error;
      resolve(Boolean(data.ok));
    }
    window.addEventListener("message", receive);
    window.postMessage({ source:"prezzolibri-app", type:"START_EXTENSION", requestId }, location.origin);
  });
}

$("#searchMarketplaces").addEventListener("click", async () => {
  const button = $("#searchMarketplaces"); button.disabled = true;
  $("#marketStatus").textContent = "Controllo se l’estensione PrezzoLibri è disponibile…";
  if (await startExtensionSearch()) {
    $("#marketStatus").textContent = "Estensione avviata: raccolgo i prezzi dalle pagine complete…";
    return;
  }
  $("#marketStatus").textContent = "Estensione non disponibile: avvio la ricerca dal server…";
  try {
    const data = await request(`/api/books/${state.book.id}/search-marketplaces`, { method:"POST", body:"{}" });
    state.marketplaceResults = data.results; renderMarketplaceResults(data.results);
    const found = data.results.reduce((total, result) => total + result.listings.length, 0);
    const cleanup = data.removedDuplicates ? ` Rimossi ${data.removedDuplicates} duplicati.` : "";
    $("#marketStatus").textContent = data.added ? `${found} prezzi letti direttamente; ${data.added} nuovi confronti aggiunti.${cleanup} Prezzo ricalcolato.` : `Ricerca diretta completata: ${found} prezzi letti, nessun nuovo confronto.${cleanup}`;
    await openBook(state.book.id); state.marketplaceResults = data.results; renderMarketplaceResults(data.results);
  } catch (error) { $("#marketStatus").textContent = error.message; }
  finally { button.disabled = false; }
});

window.addEventListener("message", async event => {
  const data = event.data;
  if (event.origin !== location.origin || data?.source !== "prezzolibri-extension") return;
  const batchEntry = data.isbn ? batchEntries.get(data.isbn) : null;
  if (batchEntry?.book) {
    if (data.type === "PROGRESS") { updateBatchEntry(data.isbn, { stage:data.message || "Marketplace in elaborazione…", className:"is-running" }); return; }
    if (data.type === "ERROR") {
      updateBatchEntry(data.isbn, { stage:`Ricerca interrotta: ${data.error || "errore sconosciuto"}`, className:"is-error" });
      releaseBatchPriceSlot(batchEntry);
      return;
    }
    if (data.type === "COMPLETE") {
      try {
        const found = (data.results || []).reduce((total, result) => total + (result.listings || []).length, 0);
        updateBatchEntry(data.isbn, { stage:`Salvo ${found} prezzi…`, className:"is-running" });
        await request(`/api/books/${batchEntry.book.id}/import-marketplaces`, { method:"POST", body:JSON.stringify({ results:data.results || [], coverUrl:data.coverUrl || "" }) });
        updateBatchEntry(data.isbn, { stage:`Completato · ${found} ${found === 1 ? "prezzo" : "prezzi"}`, className:"is-done" });
        await loadBooks();
      } catch (error) {
        updateBatchEntry(data.isbn, { stage:`Sincronizzazione non riuscita: ${error.message}`, className:"is-error" });
      } finally { releaseBatchPriceSlot(batchEntry); }
      return;
    }
  }
  if (data.type === "ERROR") { $("#marketStatus").textContent = `Estensione interrotta: ${data.error || "errore sconosciuto"}`; $("#searchMarketplaces").disabled = false; return; }
  if (data.type === "PROGRESS") { $("#marketStatus").textContent = data.message; return; }
  if (data.type !== "COMPLETE" || !state.book || data.isbn !== state.book.isbn) return;
  try {
    $("#extensionLogPanel").hidden = false;
    $("#extensionLogPanel").open = true;
    const technicalLog = [...(data.logs || []), { stage:"ricezione nell’app", extensionVersion:data.extensionVersion||"assente", coverFound:Boolean(data.coverUrl), coverUrl:data.coverUrl||"" }];
    $("#extensionLogs").textContent = JSON.stringify(technicalLog, null, 2);
    state.marketplaceResults = data.results;
    renderMarketplaceResults(data.results);
    const found = data.results.reduce((total, result) => total + result.listings.length, 0);
    $("#marketStatus").textContent = `${found} prezzi letti dal tuo Chrome. Li sincronizzo…`;
    const imported = await request(`/api/books/${state.book.id}/import-marketplaces`, { method:"POST", body:JSON.stringify({ results:data.results, coverUrl:data.coverUrl }) });
    technicalLog.push({stage:"salvataggio database",coverSaved:Boolean(imported.coverSaved),coverUrl:imported.coverUrl||""});
    $("#extensionLogs").textContent = JSON.stringify(technicalLog, null, 2);
    await openBook(state.book.id);
    await loadBooks();
    state.marketplaceResults = data.results;
    renderMarketplaceResults(data.results);
    const cleanup = imported.removedDuplicates ? ` Rimossi ${imported.removedDuplicates} duplicati.` : "";
    const coverStatus = imported.coverSaved ? " Copertina Amazon ricevuta e salvata." : ` Nessuna copertina ricevuta dall’estensione ${data.extensionVersion||"non aggiornata"}.`;
    $("#marketStatus").textContent = `${found} prezzi letti dal tuo Chrome; ${imported.added} nuovi confronti aggiunti.${cleanup}${coverStatus}`;
  } catch (error) { $("#marketStatus").textContent = `Raccolta completata, ma la sincronizzazione non è riuscita: ${error.message}`; }
  finally { $("#searchMarketplaces").disabled = false; }
});

$("#isbnForm").addEventListener("submit", async event => {
  event.preventDefault(); $("#isbnStatus").textContent = "Cerco titolo ed edizione…";
  try { const data = await request(`/api/isbn/${encodeURIComponent($("#isbn").value)}`); $("#isbnStatus").textContent = `Trovato tramite ${data.source || "i cataloghi disponibili"}`; showEditor(data); }
  catch (error) {
    const isbn = $("#isbn").value.replace(/[^0-9X]/gi, "");
    if (/^(?:97[89]\d{10}|\d{9}[\dX])$/i.test(isbn)) { showEditor({ isbn }); $("#isbnStatus").textContent = `${error.message}. Completa titolo e autore manualmente.`; }
    else $("#isbnStatus").textContent = error.message;
  }
});

$("#batchForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (batchRunning || batchPriceActive || batchPriceQueue.length) { $("#batchStatus").textContent = "È già in corso una ricerca multipla."; return; }
  const parsed = parseBatchIsbns($("#batchIsbns").value, BATCH_MAX_BOOKS);
  if (!parsed.valid.length) { $("#batchStatus").textContent = "Inserisci almeno un ISBN-10 o ISBN-13 valido."; return; }
  batchRunning = true;
  $("#batchStart").disabled = true;
  $("#batchResults").innerHTML = "";
  batchEntries.clear();
  parsed.valid.forEach(isbn => {
    const entry = { isbn, stage:"In attesa", detail:"Ricerca non ancora iniziata", className:"" };
    batchEntries.set(isbn, entry); renderBatchEntry(entry);
  });
  const warnings = [parsed.invalid.length ? `${parsed.invalid.length} valore non valido ignorato.` : "", parsed.excess ? ` Elaboro soltanto i primi ${BATCH_MAX_BOOKS} ISBN.` : ""].join("");
  $("#batchStatus").textContent = `${parsed.valid.length} libri in elaborazione. ${warnings}`;
  try {
    await runPool(parsed.valid, BATCH_METADATA_CONCURRENCY, identifyBatchBook);
    await loadBooks();
    const identified = [...batchEntries.values()].filter(item => item.book).length;
    $("#batchStatus").textContent = `${identified} di ${parsed.valid.length} libri identificati. La ricerca prezzi continua automaticamente, due libri alla volta.`;
  } finally {
    batchRunning = false;
    $("#batchStart").disabled = Boolean(batchPriceActive || batchPriceQueue.length);
  }
});

$("#batchClear").addEventListener("click", () => {
  if (batchRunning || batchPriceActive) { $("#batchStatus").textContent = "Attendi la conclusione delle ricerche già avviate prima di pulire l’elenco."; return; }
  $("#batchIsbns").value = ""; $("#batchResults").innerHTML = ""; $("#batchStatus").textContent = ""; batchEntries.clear();
});

$("#photo").addEventListener("change", async event => {
  const file = event.target.files[0]; if (!file) return;
  $("#isbnStatus").textContent = "Leggo l’ISBN dalla foto…";
  try {
    const isbn = await decodeBarcodeFile(file);
    $("#isbn").value = isbn; $("#isbnStatus").textContent = `ISBN letto: ${isbn}`; $("#isbnForm").requestSubmit();
  } catch (error) { $("#isbnStatus").textContent = `${error.message}. Prova una foto più ravvicinata o inserisci le cifre.`; }
});
$("#startScanner").addEventListener("click", () => startLiveScanner(isbn => {
  $("#isbn").value = isbn;
  $("#isbnStatus").textContent = `✓ ISBN letto: ${isbn}`;
  $("#isbnForm").requestSubmit();
}));
$("#stopScanner").addEventListener("click", () => stopLiveScanner());
$("#bookSearch").addEventListener("input", renderBookList);

$("#bookForm").addEventListener("submit", async event => {
  event.preventDefault();const submitButton=$("#saveBook");submitButton.disabled=true;submitButton.dataset.state="loading";submitButton.textContent="Salvataggio in corso…";const payload = { isbn:$("#bookIsbn").value,title:$("#title").value,authors:$("#authors").value,publisher:$("#publisher").value,year:$("#year").value,coverUrl:$("#cover").src.startsWith("data:")?"":$("#cover").src,coverPrice:Number($("#coverPrice").value)||null,condition:$("#condition").value,notes:$("#notes").value };
  try{const book=await request("/api/books",{method:"POST",body:JSON.stringify(payload)});submitButton.textContent="Libro salvato · avvio valutazione…";await openBook(book.id);await loadBooks();$("#marketStatus").textContent="Libro salvato. Avvio automaticamente la ricerca di copertina e prezzi…";$("#searchMarketplaces").click();setTimeout(()=>{submitButton.disabled=false;submitButton.dataset.state="";submitButton.textContent="Salva e valuta";},1800);}catch(error){submitButton.disabled=false;submitButton.dataset.state="";submitButton.textContent="Salva e valuta";$("#marketStatus").textContent=`Salvataggio non riuscito: ${error.message}`;}
});

$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault(); $("#loginStatus").textContent = "Accesso in corso…";
  try {
    await request("/api/session", { method:"POST", body:JSON.stringify({ username:$("#loginUsername").value, password:$("#loginPassword").value }) });
    $("#loginPassword").value = ""; $("#loginDialog").close(); await loadInitialView();
  } catch (error) { $("#loginStatus").textContent = error.message; }
});
$("#loginDialog").addEventListener("cancel", event => event.preventDefault());

$("#logout").addEventListener("click", async () => {
  stopLiveScanner(); await request("/api/session", { method:"DELETE" }); state.book = null; $("#loginForm").reset(); $("#loginDialog").showModal();
});

function home(){ stopLiveScanner();history.replaceState(null,"",`${location.pathname}${location.hash}`);$("#editorView").hidden=true;$("#startView").hidden=false;loadBooks();requestAnimationFrame(()=>{$("#isbn").focus();$("#isbn").select();}); }
$("#homeLink").addEventListener("click",event=>{event.preventDefault();home();window.scrollTo({top:0,behavior:"smooth"});});$("#back").addEventListener("click",home);$("#newBook").addEventListener("click",()=>{showEditor({});$("#editorView").hidden=true;$("#startView").hidden=false;$("#isbn").focus();});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !$("#startView").hidden && !$("#loginDialog").open) loadBooks().catch(() => {});
});
async function loadInitialView() {
  await loadBooks();
  const requestedBook = new URLSearchParams(location.search).get("book");
  if (requestedBook) await openBook(requestedBook);
}
requireLogin().then(ok => { if (ok) loadInitialView(); }).catch(error => { $("#loginStatus").textContent = error.message; $("#loginDialog").showModal(); });
