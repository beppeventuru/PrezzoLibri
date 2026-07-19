import { request } from "./cloud-api.js";

const $ = selector => document.querySelector(selector);
const state = { book: null, marketplaceResults: null };
let scannerLibraryPromise = null;
let scannerControls = null;
let scannerStream = null;
let scannerReading = false;
const euro = value => value == null ? "—" : new Intl.NumberFormat("it-IT", { style:"currency", currency:"EUR" }).format(value);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[character]);
const usableCoverUrl = value => value && !/books\.google\.com\/books\/content/i.test(value) ? value : "";

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
  const noCover = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='230'%3E%3Crect width='100%25' height='100%25' fill='%23e8e1d5'/%3E%3Cpath d='M48 55h64v90H48z' fill='none' stroke='%23756f66' stroke-width='5'/%3E%3Cpath d='M58 72h44M58 88h34M58 104h39' stroke='%23756f66' stroke-width='4'/%3E%3C/svg%3E";
  $("#bookList").innerHTML = books.length ? books.map(book => `<button class="book-row" data-id="${book.id}"><img src="${escapeHtml(usableCoverUrl(book.cover_url) || noCover)}" alt="Copertina di ${escapeHtml(book.title)}"><span class="book-row-copy"><b>${escapeHtml(book.title)}</b><small>${escapeHtml(book.authors || "Autore non indicato")}</small><em>ISBN ${escapeHtml(book.isbn)}</em></span><span class="book-row-price"><small>Prezzo consigliato</small><strong>${euro(book.analysis?.recommendedPrice)}</strong></span></button>`).join("") : `<p class="empty">Nessun libro ancora valutato.</p>`;
  document.querySelectorAll(".book-row img").forEach(image => image.addEventListener("error", () => { image.src = noCover; }, { once:true }));
  document.querySelectorAll(".book-row").forEach(button => button.addEventListener("click", () => openBook(button.dataset.id)));
}

function showEditor(metadata) {
  $("#startView").hidden = true; $("#editorView").hidden = false;
  $("#bookId").value = metadata.id || ""; $("#bookIsbn").value = metadata.isbn || ""; $("#title").value = metadata.title || "";
  $("#authors").value = metadata.authors || ""; $("#publisher").value = metadata.publisher || ""; $("#year").value = metadata.year || "";
  $("#coverPrice").value = metadata.cover_price ?? metadata.coverPrice ?? ""; $("#condition").value = metadata.condition || "good"; $("#notes").value = metadata.notes || "";
  $("#cover").src = usableCoverUrl(metadata.cover_url || metadata.coverUrl) || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='340'%3E%3Crect width='100%25' height='100%25' fill='%23e8e1d5'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' fill='%23756f66'%3ENessuna copertina%3C/text%3E%3C/svg%3E";
  $("#workspace").hidden = !metadata.id;
}

function savedMarketplaceResults(comparables=[]) {
  const platforms=["vinted","ebay","abebooks","subito","libraccio","ibs","amazon"];
  return platforms.map(platform=>{const listings=comparables.filter(item=>item.platform===platform).map(item=>({title:item.title,price:Number(item.price),shipping:Number(item.shipping||0),url:item.url,condition:item.condition,relevance:item.relevance,evidenceType:item.evidence_type||"active"}));return{platform,status:listings.length?"found":"not_found",note:"Risultati salvati per questo libro.",listings};});
}

async function openBook(id) { state.book = await request(`/api/books/${id}`);state.marketplaceResults=savedMarketplaceResults(state.book.comparables);showEditor(state.book);renderWorkspace();renderMarketplaceResults(state.marketplaceResults); }

function renderWorkspace() {
  const b = state.book, a = b.analysis;
  $("#recommended").textContent = euro(a.recommendedPrice); $("#quick").textContent = euro(a.quickPrice); $("#maximum").textContent = euro(a.maximumPrice);
  $("#confidence").textContent = `Affidabilità ${a.confidence === "high" ? "alta" : a.confidence === "medium" ? "media" : "bassa"} · mediana mercato ${euro(a.marketMedian)}`;
  $("#explanation").textContent = a.explanation;
  const names = { vinted:"Vinted", ebay:"eBay", abebooks:"AbeBooks", subito:"Subito", libraccio:"Libraccio", ibs:"IBS", amazon:"Amazon" };
  $("#marketLinks").innerHTML = Object.entries(names).map(([key,name]) => `<article><h3>${name}</h3><a href="${b.links[key]}" target="_blank" rel="noopener">In vendita · ISBN ↗</a>${b.links.titleFallback?.[key] ? `<a class="fallback" href="${b.links.titleFallback[key]}" target="_blank" rel="noopener">In vendita · titolo ↗</a>` : ""}${b.links.sold?.[key] ? `<a class="sold-link" href="${b.links.sold[key]}" target="_blank" rel="noopener">Venduti ultimi 90 giorni ↗</a><small class="sold-note">eBay non mostra qui le vendite più vecchie.</small>` : ""}</article>`).join("");
  if (!state.marketplaceResults) $("#marketResults").innerHTML = `<p class="empty">Premi “Cerca i prezzi”: i risultati appariranno direttamente qui.</p>`;
}

function renderMarketplaceResults(results) {
  const names = { vinted:"Vinted", ebay:"eBay", abebooks:"AbeBooks", subito:"Subito", libraccio:"Libraccio", ibs:"IBS", amazon:"Amazon" };
  const listingRows = listings => listings.map(item => `<div class="listing"><div><b>${escapeHtml(item.title || "Offerta")}</b><small>${item.relevance === "exact" ? "ISBN esatto" : item.relevance === "high" ? "Stessa edizione probabile" : "Da verificare"}${item.condition ? ` · ${escapeHtml(item.condition)}` : ""}</small></div><strong>${euro(item.price + item.shipping)}</strong><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Verifica ↗</a></div>`).join("");
  const sections = results.flatMap(result => result.platform !== "ebay" ? [{ ...result, label:names[result.platform] || result.platform }] : [
    { ...result, label:"eBay in vendita", listings:result.listings.filter(item => item.evidenceType !== "sold"), emptyNote:"Nessun annuncio attivo pertinente." },
    { ...result, label:"eBay venduti", listings:result.listings.filter(item => item.evidenceType === "sold"), emptyNote:"Nessuna vendita conclusa trovata.", soldSection:true }
  ]);
  $("#marketResults").innerHTML = sections.map(result => `<details class="market-result${result.soldSection ? " sold-market-result" : ""}"><summary class="market-result-head"><h3>${escapeHtml(result.label)}</h3><span class="${result.listings.length ? "found" : escapeHtml(result.status)}">${result.listings.length ? `${result.listings.length} ${result.listings.length === 1 ? "risultato" : "risultati"}` : result.status === "blocked" ? "Non accessibile" : "Nessun risultato"}</span></summary><div class="market-result-body">${result.soldSection ? `<p class="sold-explanation">Vendite concluse: sono il riferimento più importante per stimare il prezzo reale.</p>` : ""}${result.listings.length ? listingRows(result.listings) : `<p class="empty">${escapeHtml(result.emptyNote || result.note || "Nessuna offerta verificabile trovata.")}</p>`}</div></details>`).join("");
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
  event.preventDefault();const submitButton=$("#saveBook");submitButton.disabled=true;submitButton.dataset.state="loading";submitButton.textContent="Salvataggio in corso…";const payload = { isbn:$("#bookIsbn").value,title:$("#title").value,authors:$("#authors").value,publisher:$("#publisher").value,year:$("#year").value,coverUrl:$("#cover").src.startsWith("data:")?"":$("#cover").src,coverPrice:Number($("#coverPrice").value)||null,condition:$("#condition").value,notes:$("#notes").value };
  try{const book=await request("/api/books",{method:"POST",body:JSON.stringify(payload)});submitButton.textContent="Libro salvato · avvio valutazione…";await openBook(book.id);await loadBooks();$("#marketStatus").textContent="Libro salvato. Avvio automaticamente la ricerca di copertina e prezzi…";$("#searchMarketplaces").click();setTimeout(()=>{submitButton.disabled=false;submitButton.dataset.state="";submitButton.textContent="Salva e valuta";},1800);}catch(error){submitButton.disabled=false;submitButton.dataset.state="";submitButton.textContent="Salva e valuta";$("#marketStatus").textContent=`Salvataggio non riuscito: ${error.message}`;}
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

function home(){ stopLiveScanner();$("#editorView").hidden=true;$("#startView").hidden=false;loadBooks();requestAnimationFrame(()=>{$("#isbn").focus();$("#isbn").select();}); }
$("#homeLink").addEventListener("click",event=>{event.preventDefault();home();window.scrollTo({top:0,behavior:"smooth"});});$("#back").addEventListener("click",home);$("#newBook").addEventListener("click",()=>{showEditor({});$("#editorView").hidden=true;$("#startView").hidden=false;$("#isbn").focus();});
requireLogin().then(ok => { if (ok) loadBooks(); }).catch(error => { $("#loginStatus").textContent = error.message; $("#loginDialog").showModal(); });
