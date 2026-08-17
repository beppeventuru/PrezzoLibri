import { $ } from "./ui-utils.js";

let scannerLibraryPromise = null;
let scannerControls = null;
let scannerStream = null;
let scannerReading = false;

function loadScannerLibrary() {
  if (window.ZXingBrowser) return Promise.resolve(window.ZXingBrowser);
  if (scannerLibraryPromise) return scannerLibraryPromise;
  scannerLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/@zxing/browser@0.2.0/umd/zxing-browser.min.js";
    script.async = true;
    script.dataset.barcodeScanner = "true";
    script.addEventListener("load", () => resolve(window.ZXingBrowser));
    script.addEventListener("error", () => reject(new Error("Impossibile caricare il lettore gratuito ZXing")));
    document.head.append(script);
  }).catch(error => {
    scannerLibraryPromise = null;
    throw error;
  });
  return scannerLibraryPromise;
}

export async function decodeBarcodeFile(file) {
  if ("BarcodeDetector" in window) {
    try {
      const detector = new BarcodeDetector({ formats:["ean_13"] });
      const results = await detector.detect(await createImageBitmap(file));
      const value = results.find(item => /^97[89]\d{10}$/.test(item.rawValue))?.rawValue;
      if (value) return value;
    } catch {}
  }
  const ZXingBrowser = await loadScannerLibrary();
  const Reader = ZXingBrowser.BrowserMultiFormatOneDReader || ZXingBrowser.BrowserMultiFormatReader;
  if (!Reader) throw new Error("Lettore ZXing non disponibile");
  const reader = new Reader();
  const objectUrl = URL.createObjectURL(file);
  try {
    const result = await reader.decodeFromImageUrl(objectUrl);
    const value = result?.getText?.() || "";
    if (!/^97[89]\d{10}$/.test(value)) throw new Error("Il codice letto non è un ISBN");
    return value;
  } finally {
    URL.revokeObjectURL(objectUrl);
    reader.reset?.();
  }
}

function setStatus(message, state = "") {
  $("#scannerStatus").textContent = message;
  $("#scannerPanel").dataset.state = state;
}

export function stopLiveScanner({ hide = true } = {}) {
  scannerControls?.stop?.();
  scannerControls = null;
  scannerStream?.getTracks?.().forEach(track => track.stop());
  scannerStream = null;
  $("#scannerVideo").srcObject = null;
  scannerReading = false;
  if (hide) $("#scannerPanel").hidden = true;
  $("#startScanner").disabled = false;
}

async function acceptScannedIsbn(rawValue, onDetected) {
  if (scannerReading) return;
  const isbn = String(rawValue || "").replace(/[^0-9X]/gi, "");
  if (!/^97[89]\d{10}$/.test(isbn)) {
    setStatus("Codice rilevato, ma non è un ISBN valido. Continua a inquadrare.", "warning");
    return;
  }
  scannerReading = true;
  setStatus(`✓ ISBN letto: ${isbn}`, "success");
  await new Promise(resolve => setTimeout(resolve, 700));
  stopLiveScanner();
  onDetected(isbn);
}

export async function startLiveScanner(onDetected) {
  if (scannerControls || scannerStream) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    $("#isbnStatus").textContent = "La scansione in diretta richiede HTTPS. Usa “Carica una foto” oppure apri l’app da una connessione sicura.";
    return;
  }
  $("#startScanner").disabled = true;
  $("#scannerPanel").hidden = false;
  setStatus("Autorizza la fotocamera e inquadra soltanto il codice a barre.");
  try {
    const ZXingBrowser = await loadScannerLibrary();
    scannerStream = await navigator.mediaDevices.getUserMedia({ audio:false, video:{ facingMode:{ ideal:"environment" }, width:{ ideal:1280 }, height:{ ideal:720 } } });
    const track = scannerStream.getVideoTracks()[0];
    try { await track.applyConstraints({ advanced:[{ focusMode:"continuous" }] }); } catch {}
    $("#scannerVideo").srcObject = scannerStream;
    const Reader = ZXingBrowser.BrowserMultiFormatOneDReader || ZXingBrowser.BrowserMultiFormatReader;
    if (!Reader) throw new Error("Lettore ZXing non disponibile");
    const reader = new Reader();
    scannerControls = await reader.decodeFromStream(scannerStream, $("#scannerVideo"), result => {
      if (result) acceptScannedIsbn(result.getText(), onDetected);
    });
    setStatus("Fotocamera attiva: centra il barcode nel riquadro e tieni fermo il libro.");
  } catch (error) {
    stopLiveScanner({ hide:false });
    setStatus(error.name === "NotAllowedError" ? "Permesso fotocamera negato. Abilitalo nelle impostazioni del browser." : error.message, "error");
  }
}
