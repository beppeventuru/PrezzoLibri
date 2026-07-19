import { request } from "./cloud-api.js";

const $ = selector => document.querySelector(selector);
const state = { book: null, marketplaceResults: null };
let scannerLibraryPromise = null;
let scannerControls = null;
let scannerStream = null;
let scannerReading = false;
const euro = value => value == null ? "—" : new Intl.NumberFormat("it-IT", { style:"currency", currency:"EUR" }).format(value);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[character]);

function loadScannerLibrary() {
  if (window.ZXingBrowser) return Promise.resolve(window.ZXingBrowser);
  if (scannerLibraryPromise) return scannerLibraryPromise;
  scannerLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/@zxing/browser@0.2.0/umd/zxing-browser.min.js";
    script.async = true; script.dataset.barcodeScanner = "true";
    script.addEventListener("load", () => resolve(window.ZXingBrowser));
    script.addEventListener("error", () => reject(new Error("Impossibile caricare il lettore gratuito ZXing")));
    document.head.append(script);
  }).catch(error => { scannerLibraryPromise = null; throw error; });
  return scannerLibraryPromise;
}

async function decodeBarcodeFile(file) {
  if ("BarcodeDetector" in window) {
    try { const detector = new BarcodeDetector({ formats:["ean_13"] }); const results = await detector.detect(await createImageBitmap(file)); const value = results.find(item => /^97[89]\d{10}$/.test(item.rawValue))?.rawValue; if (value) return value; } catch {}
  }
  const ZXingBrowser = await loadScannerLibrary();
  const Reader = ZXingBrowser.BrowserMultiFormatOneDReader || ZXingBrowser.BrowserMultiFormatReader;
  if (!Reader) throw new Error("Lettore ZXing non disponibile");
  const reader = new Reader(); const objectUrl = URL.createObjectURL(file);
  try { const result = await reader.decodeFromImageUrl(objectUrl); const value = result?.getText?.() || ""; if (!/^97[89]\d{10}$/.test(value)) throw new Error("Il codice letto non è un ISBN"); return value; }
  finally { URL.revokeObjectURL(objectUrl); reader.reset?.(); }
}

function setLiveScannerStatus(message, state = "") {
  $("#scannerStatus").textContent = message;
  $("#scannerPanel").dataset.state = state;
}

function stopLiveScanner({ hide = true } = {}) {
  scannerControls?.stop?.(); scannerControls = null;
  scannerStream?.getTracks?.().forEach(track => track.stop()); scannerStream = null;
  $("#scannerVideo").srcObject = null; scannerReading = false;
  if (hide) $("#scannerPanel").hidden = true;
  $("#startScanner").disabled = false;
}

async function acceptScannedIsbn(rawValue) {
  if (scannerReading) return;
  const isbn = String(rawValue || "").replace(/[^0-9X]/gi, "");
  if (!/^97[89]\d{10}$/.test(isbn)) { setLiveScannerStatus("Codice rilevato, ma non è un ISBN valido. Continua a inquadrare.", "warning"); return; }
  scannerReading = true; $("#isbn").value = isbn;
  setLiveScannerStatus(`✓ ISBN letto: ${isbn}`, "success");
  $("#isbnStatus").textContent = `✓ ISBN letto: ${isbn}`;
  await new Promise(resolve => setTimeout(resolve, 700));
  stopLiveScanner(); $("#isbnForm").requestSubmit();
}

async function startLiveScanner() {
  if (scannerControls || scannerStream) return;
  if (!navigator.mediaDevices?.getUserMedia) { $("#isbnStatus").textContent = "La scansione in diretta richiede HTTPS. Usa “Carica una foto” oppure apri l’app da una connessione sicura."; return; }
  $("#startScanner").disabled = true; $("#scannerPanel").hidden = false;
  setLiveScannerStatus("Autorizza la fotocamera e inquadra soltanto il codice a barre.");
  try {
    const ZXingBrowser = await loadScannerLibrary();
    scannerStream = await navigator.mediaDevices.getUserMedia({ audio:false, video:{ facingMode:{ ideal:"environment" }, width:{ ideal:1280 }, height:{ ideal:720 } } });
    const track = scannerStream.getVideoTracks()[0];
    try { await track.applyConstraints({ advanced:[{ focusMode:"continuous" }] }); } catch {}
    $("#scannerVideo").srcObject = scannerStream;
    const Reader = ZXingBrowser.BrowserMultiFormatOneDReader || ZXingBrowser.BrowserMultiFormatReader;
    if (!Reader) throw new Error("Lettore ZXing non disponibile");
    const reader = new Reader();
    scannerControls = await reader.decodeFromStream(scannerStream, $("#scannerVideo"), result => { if (result) acceptScannedIsbn(result.getText()); });
    setLiveScannerStatus("Fotocamera attiva: centra il barcode nel riquadro e tieni fermo il libro.");
  } catch (error) { stopLiveScanner({ hide:false }); setLiveScannerStatus(error.name === "NotAllowedError" ? "Permesso fotocamera negato. Abilitalo nelle impostazioni del browser." : error.message, "error"); }
}

async function requireLogin() {
  const session = await request("/api/session");
  if (!session.authenticated) {
    $("#loginStatus").textContent = session.configured ? "" : "Configura APP_USERNAME e APP_PASSWORD nel file .env.";
    $("#loginDialog").showModal();
    return false;
  }
  return true;
}

async function loadBooks() {
  const books = await request("/api/books");
  $("#bookList").innerHTML = books.length ? books.map(book => `<button class="book-row" data-id="${book.id}"><span>${book.title}</span><small>${book.authors || "Autore non indicato"} · ${book.isbn}</small></button>`).join("") : `<p class="empty">Nessun libro ancora valutato.</p>`;
  document.querySelectorAll(".book-row").forEach(button => button.addEventListener("click", () => openBook(button.dataset.id)));
}

function showEditor(metadata) {
  $("#startView").hidden = true; $("#editorView").hidden = false;
  $("#bookId").value = metadata.id || ""; $("#bookIsbn").value = metadata.isbn || ""; $("#title").value = metadata.title || "";
  $("#authors").value = metadata.authors || ""; $("#publisher").value = metadata.publisher || ""; $("#year").value = metadata.year || "";
  $("#coverPrice").value = metadata.cover_price ?? metadata.coverPrice ?? ""; $("#condition").value = metadata.condition || "good"; $("#notes").value = metadata.notes || "";
  $("#cover").src = metadata.cover_url || metadata.coverUrl || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='340'%3E%3Crect width='100%25' height='100%25' fill='%23e8e1d5'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' fill='%23756f66'%3ENessuna copertina%3C/text%3E%3C/svg%3E";
  $("#workspace").hidden = !metadata.id;
}

async function openBook(id) { state.book = await request(`/api/books/${id}`); showEditor(state.book); renderWorkspace(); }

function renderWorkspace() {
  const b = state.book, a = b.analysis;
  $("#recommended").textContent = euro(a.recommendedPrice); $("#quick").textContent = euro(a.quickPrice); $("#maximum").textContent = euro(a.maximumPrice);
  $("#confidence").textContent = `Affidabilità ${a.confidence === "high" ? "alta" : a.confidence === "medium" ? "media" : "bassa"} · mediana mercato ${euro(a.marketMedian)}`;
  $("#explanation").textContent = a.explanation;
  const names = { vinted:"Vinted", ebay:"eBay", abebooks:"AbeBooks", subito:"Subito", amazon:"Amazon" };
  $("#marketLinks").innerHTML = Object.entries(names).map(([key,name]) => `<article><h3>${name}</h3><a href="${b.links[key]}" target="_blank" rel="noopener">In vendita · ISBN ↗</a>${b.links.titleFallback?.[key] ? `<a class="fallback" href="${b.links.titleFallback[key]}" target="_blank" rel="noopener">In vendita · titolo ↗</a>` : ""}${b.links.sold?.[key] ? `<a class="sold-link" href="${b.links.sold[key]}" target="_blank" rel="noopener">Venduti ultimi 90 giorni ↗</a><small class="sold-note">eBay non mostra qui le vendite più vecchie.</small>` : ""}</article>`).join("");
  if (!state.marketplaceResults) $("#marketResults").innerHTML = `<p class="empty">Premi “Cerca i prezzi”: i risultati appariranno direttamente qui.</p>`;
  $("#comparableList").innerHTML = b.comparables.length ? b.comparables.map(c => `<article class="comparable"><div><b>${c.platform}</b><span>${c.evidence_type === "sold" ? "VENDUTO" : "ATTIVO"}</span><h3>${c.title || "Confronto senza titolo"}</h3><small>${c.relevance.replace("exact","ISBN esatto")} · ${new Date(c.observed_at).toLocaleDateString("it-IT")}</small></div><strong>${euro(c.price + c.shipping)}</strong>${c.url ? `<a href="${c.url}" target="_blank" rel="noopener">Apri ↗</a>`:""}<button class="remove-comparable" data-comparable-id="${c.id}" type="button">Elimina</button></article>`).join("") : `<p class="empty">Nessun confronto: apri i marketplace e aggiungi i risultati pertinenti.</p>`;
}

function renderMarketplaceResults(results) {
  const names = { vinted:"Vinted", ebay:"eBay", abebooks:"AbeBooks", subito:"Subito", amazon:"Amazon" };
  const listingRows = listings => listings.map(item => `<div class="listing"><div><b>${escapeHtml(item.title || "Offerta")}</b><small>${item.relevance === "exact" ? "ISBN esatto" : item.relevance === "high" ? "Stessa edizione probabile" : "Da verificare"}${item.condition ? ` · ${escapeHtml(item.condition)}` : ""}</small></div><strong>${euro(item.price + item.shipping)}</strong><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Verifica ↗</a></div>`).join("");
  const ebayGroups = listings => {
    const active = listings.filter(item => item.evidenceType !== "sold");
    const sold = listings.filter(item => item.evidenceType === "sold");
    return `<div class="ebay-groups"><details class="ebay-group"><summary><span>In vendita</span><b>${active.length}</b></summary>${active.length ? listingRows(active) : `<p class="empty">Nessun annuncio attivo pertinente.</p>`}</details><details class="ebay-group sold-group"><summary><span>Venduti</span><b>${sold.length}</b></summary><p class="sold-explanation">Vendite concluse: sono il riferimento più importante per stimare il prezzo reale.</p>${sold.length ? listingRows(sold) : `<p class="empty">Nessuna vendita conclusa trovata.</p>`}</details></div>`;
  };
  $("#marketResults").innerHTML = results.map(result => `<details class="market-result"><summary class="market-result-head"><h3>${escapeHtml(names[result.platform] || result.platform)}</h3><span class="${escapeHtml(result.status)}">${result.listings.length ? `${result.listings.length} risultati` : result.status === "blocked" ? "Non accessibile" : "Nessun risultato"}</span></summary><div class="market-result-body">${result.platform === "ebay" ? ebayGroups(result.listings) : result.listings.length ? listingRows(result.listings) : `<p class="empty">${escapeHtml(result.note || "Nessuna offerta verificabile trovata.")}</p>`}</div></details>`).join("");
}

$("#searchMarketplaces").addEventListener("click", async () => {
  const button = $("#searchMarketplaces"); button.disabled = true;
  $("#marketStatus").textContent = "Apro direttamente le cinque ricerche ISBN e leggo i prezzi visibili…";
  try {
    const data = await request(`/api/books/${state.book.id}/search-marketplaces`, { method:"POST", body:"{}" });
    state.marketplaceResults = data.results; renderMarketplaceResults(data.results);
    const found = data.results.reduce((total, result) => total + result.listings.length, 0);
    $("#marketStatus").textContent = data.added ? `${found} prezzi letti direttamente; ${data.added} nuovi confronti aggiunti. Prezzo ricalcolato.` : `Ricerca diretta completata: ${found} prezzi letti, nessun nuovo confronto.`;
    await openBook(state.book.id); state.marketplaceResults = data.results; renderMarketplaceResults(data.results);
  } catch (error) { $("#marketStatus").textContent = error.message; }
  finally { button.disabled = false; }
});

window.addEventListener("message", async event => {
  const data = event.data;
  if (event.origin !== location.origin || data?.source !== "prezzolibri-extension") return;
  if (data.type === "PROGRESS") { $("#marketStatus").textContent = data.message; return; }
  if (data.type !== "COMPLETE" || !state.book || data.isbn !== state.book.isbn) return;
  try {
    $("#extensionLogPanel").hidden = false;
    $("#extensionLogs").textContent = JSON.stringify(data.logs || [], null, 2);
    state.marketplaceResults = data.results;
    renderMarketplaceResults(data.results);
    const found = data.results.reduce((total, result) => total + result.listings.length, 0);
    $("#marketStatus").textContent = `${found} prezzi letti dal tuo Chrome. Li sincronizzo…`;
    const imported = await request(`/api/books/${state.book.id}/import-marketplaces`, { method:"POST", body:JSON.stringify({ results:data.results }) });
    await openBook(state.book.id);
    state.marketplaceResults = data.results;
    renderMarketplaceResults(data.results);
    $("#marketStatus").textContent = `${found} prezzi letti dal tuo Chrome; ${imported.added} nuovi confronti aggiunti.`;
  } catch (error) { $("#marketStatus").textContent = `Raccolta completata, ma la sincronizzazione non è riuscita: ${error.message}`; }
});

$("#comparableList").addEventListener("click", async event => {
  const button = event.target.closest("[data-comparable-id]");
  if (!button || !confirm("Eliminare questo confronto dal calcolo del prezzo?")) return;
  button.disabled = true;
  try { await request(`/api/comparables/${button.dataset.comparableId}`, { method:"DELETE" }); await openBook(state.book.id); }
  catch (error) { button.disabled = false; alert(error.message); }
});

$("#isbnForm").addEventListener("submit", async event => {
  event.preventDefault(); $("#isbnStatus").textContent = "Cerco titolo ed edizione…";
  try { const data = await request(`/api/isbn/${encodeURIComponent($("#isbn").value)}`); $("#isbnStatus").textContent = `Trovato tramite ${data.source}`; showEditor(data); }
  catch (error) {
    const isbn = $("#isbn").value.replace(/[^0-9X]/gi, "");
    if (/^(?:97[89]\d{10}|\d{9}[\dX])$/i.test(isbn)) { showEditor({ isbn }); $("#isbnStatus").textContent = `${error.message}. Completa titolo e autore manualmente.`; }
    else $("#isbnStatus").textContent = error.message;
  }
});

$("#photo").addEventListener("change", async event => {
  const file = event.target.files[0]; if (!file) return;
  $("#isbnStatus").textContent = "Leggo l’ISBN dalla foto…";
  try {
    let isbn;
    if ("BarcodeDetector" in window) {
      try { const detector = new BarcodeDetector({ formats:["ean_13"] }); const results = await detector.detect(await createImageBitmap(file)); isbn = results.find(x => /^97[89]\d{10}$/.test(x.rawValue))?.rawValue; } catch {}
    }
    if (!isbn) isbn = await decodeBarcodeFile(file);
    $("#isbn").value = isbn; $("#isbnStatus").textContent = `ISBN letto: ${isbn}`; $("#isbnForm").requestSubmit();
  } catch (error) { $("#isbnStatus").textContent = `${error.message}. Prova una foto più ravvicinata o inserisci le cifre.`; }
});
$("#startScanner").addEventListener("click", startLiveScanner);
$("#stopScanner").addEventListener("click", () => stopLiveScanner());

$("#bookForm").addEventListener("submit", async event => {
  event.preventDefault(); const payload = { isbn:$("#bookIsbn").value,title:$("#title").value,authors:$("#authors").value,publisher:$("#publisher").value,year:$("#year").value,coverUrl:$("#cover").src.startsWith("data:")?"":$("#cover").src,coverPrice:Number($("#coverPrice").value)||null,condition:$("#condition").value,notes:$("#notes").value };
  const book = await request("/api/books", { method:"POST", body:JSON.stringify(payload) }); await openBook(book.id);
});

$("#addComparable").addEventListener("click", () => $("#comparableDialog").showModal());
$("#cancelComparable").addEventListener("click", () => $("#comparableDialog").close());
$("#comparableForm").addEventListener("submit", async event => {
  event.preventDefault(); await request(`/api/books/${state.book.id}/comparables`, { method:"POST", body:JSON.stringify({ platform:$("#platform").value,title:$("#compTitle").value,url:$("#compUrl").value,price:Number($("#compPrice").value),shipping:Number($("#shipping").value)||0,relevance:$("#relevance").value,evidenceType:$("#evidenceType").value }) });
  $("#comparableDialog").close(); event.target.reset(); await openBook(state.book.id);
});

$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault(); $("#loginStatus").textContent = "Accesso in corso…";
  try {
    await request("/api/session", { method:"POST", body:JSON.stringify({ username:$("#loginUsername").value, password:$("#loginPassword").value }) });
    $("#loginPassword").value = ""; $("#loginDialog").close(); await loadBooks();
  } catch (error) { $("#loginStatus").textContent = error.message; }
});
$("#loginDialog").addEventListener("cancel", event => event.preventDefault());

$("#logout").addEventListener("click", async () => {
  stopLiveScanner(); await request("/api/session", { method:"DELETE" }); state.book = null; $("#loginForm").reset(); $("#loginDialog").showModal();
});

function home(){ stopLiveScanner(); $("#editorView").hidden=true;$("#startView").hidden=false;loadBooks(); }
$("#back").addEventListener("click",home);$("#newBook").addEventListener("click",()=>{showEditor({});$("#editorView").hidden=true;$("#startView").hidden=false;$("#isbn").focus();});
requireLogin().then(ok => { if (ok) loadBooks(); }).catch(error => { $("#loginStatus").textContent = error.message; $("#loginDialog").showModal(); });
