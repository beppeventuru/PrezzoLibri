import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { loadEnvFile } from "node:process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { canonicalIsbn } from "./src/isbn.mjs";
import { calculatePrice } from "./src/pricing.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
try { loadEnvFile(join(ROOT, ".env")); } catch {}
const PUBLIC = join(ROOT, "public");
const DATA = join(ROOT, "data");
await mkdir(DATA, { recursive: true });
const db = new DatabaseSync(join(DATA, "prezzo-libri.db"));
db.exec(`
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY, isbn TEXT NOT NULL UNIQUE, title TEXT NOT NULL DEFAULT '',
    authors TEXT NOT NULL DEFAULT '', publisher TEXT NOT NULL DEFAULT '', year TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '', cover_price REAL, condition TEXT NOT NULL DEFAULT 'good',
    notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS comparables (
    id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    platform TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL, shipping REAL NOT NULL DEFAULT 0, condition TEXT NOT NULL DEFAULT '',
    relevance TEXT NOT NULL DEFAULT 'medium', evidence_type TEXT NOT NULL DEFAULT 'active',
    accepted INTEGER NOT NULL DEFAULT 1, observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const PORT = Number(process.env.PORT || 4180);
const HOST = process.env.HOST || "127.0.0.1";
const googleEnabled = process.env.GOOGLE_BOOKS_ENABLED !== "false";
const openLibraryEnabled = process.env.OPEN_LIBRARY_ENABLED !== "false";
const googleKey = process.env.GOOGLE_BOOKS_API_KEY || "";
const openAiKey = process.env.OPENAI_API_KEY || "";
const openAiModel = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const appUsername = process.env.APP_USERNAME || "";
const appPassword = process.env.APP_PASSWORD || "";
const sessions = new Map();
const loginAttempts = new Map();
const SESSION_AGE = 7 * 24 * 60 * 60 * 1000;
const q = statement => db.prepare(statement);

function equalSecret(actual, expected) {
  const left = Buffer.from(String(actual)); const right = Buffer.from(String(expected));
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map(value => value.trim().split("=")).filter(parts => parts.length === 2));
}

function authenticated(req) {
  const token = cookies(req).prezzo_libri_session; const expiry = token && sessions.get(token);
  if (!expiry || expiry < Date.now()) { if (token) sessions.delete(token); return false; }
  sessions.set(token, Date.now() + SESSION_AGE); return true;
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8_000_000) throw new Error("Richiesta troppo grande");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function lookupGoogle(isbn) {
  if (!googleEnabled) return null;
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", `isbn:${isbn}`);
  if (googleKey) url.searchParams.set("key", googleKey);
  const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`Google Books ${response.status}`);
  const item = (await response.json()).items?.[0];
  if (!item) return null;
  const v = item.volumeInfo || {};
  return { isbn, title: v.title || "", authors: (v.authors || []).join(", "), publisher: v.publisher || "",
    year: String(v.publishedDate || "").slice(0, 4), coverUrl: v.imageLinks?.thumbnail?.replace("http:", "https:") || "",
    coverPrice: item.saleInfo?.listPrice?.currencyCode === "EUR" ? item.saleInfo.listPrice.amount : null,
    source: "Google Books" };
}

async function lookupOpenLibrary(isbn) {
  if (!openLibraryEnabled) return null;
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("isbn", isbn); url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: { "User-Agent": "PrezzoLibri/0.1 (personal-use)" }, signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`Open Library ${response.status}`);
  const item = (await response.json()).docs?.[0];
  if (!item) return null;
  return { isbn, title: item.title || "", authors: (item.author_name || []).join(", "), publisher: item.publisher?.[0] || "",
    year: String(item.first_publish_year || ""), coverUrl: item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg` : "",
    coverPrice: null, source: "Open Library" };
}

function searchLinks(book) {
  const exact = encodeURIComponent(book.isbn);
  const text = encodeURIComponent(`${book.title} ${book.authors}`.trim());
  return {
    vinted: `https://www.vinted.it/catalog?search_text=${exact}`,
    ebay: `https://www.ebay.it/sch/i.html?_nkw=${exact}`,
    abebooks: `https://www.abebooks.it/servlet/SearchResults?isbn=${exact}`,
    subito: `https://www.subito.it/annunci-italia/vendita/libri-riviste/?q=${exact}`,
    amazon: `https://www.amazon.it/s?k=${exact}`,
    sold: {
      ebay: `https://www.ebay.it/sch/i.html?_nkw=${text}&LH_Sold=1&LH_Complete=1`
    },
    titleFallback: {
      vinted: `https://www.vinted.it/catalog?search_text=${text}`,
      ebay: `https://www.ebay.it/sch/i.html?_nkw=${text}`,
      subito: `https://www.subito.it/annunci-italia/vendita/libri-riviste/?q=${text}`
    }
  };
}

function parseJsonAnswer(response) {
  const text = response.output?.flatMap(item => item.content || [])
    .filter(item => item.type === "output_text").map(item => item.text).join("\n") || "";
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}

async function searchMarketplaces(book) {
  if (!openAiKey) throw new Error("OPENAI_API_KEY non configurata. Inseriscila nel file .env e riavvia l'app.");
  const platforms = ["vinted", "ebay", "abebooks", "subito", "amazon"];
  const prompt = `Cerca sul web offerte attualmente visibili in Italia per questo preciso libro usato:
ISBN-13: ${book.isbn}
Titolo: ${book.title}
Autore: ${book.authors}
Editore: ${book.publisher}
Anno: ${book.year}

Cerca separatamente su Vinted.it, eBay.it, AbeBooks.it, Subito.it e Amazon.it. Dai priorita assoluta all'ISBN esatto; non attribuire l'ISBN a un annuncio se non e visibile nella pagina o nello snippet. Per Amazon includi anche il prezzo nuovo. Non inventare risultati, prezzi, spedizioni o URL. Se un sito non restituisce un'offerta verificabile, usa status "not_found".

Rispondi ESCLUSIVAMENTE con JSON valido, senza markdown:
{"results":[{"platform":"vinted|ebay|abebooks|subito|amazon","status":"found|not_found|blocked","note":"breve spiegazione","listings":[{"title":"titolo annuncio","price":9.9,"shipping":0,"currency":"EUR","url":"https://...","relevance":"exact|high|medium|low","condition":"condizioni o spedizione non nota","evidenceType":"active|sold"}]}]}
Massimo 5 offerte per sito. Solo prezzi EUR. Se la spedizione non e nota usa 0 e indicalo in condition.`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: openAiModel, tools: [{ type: "web_search" }], input: prompt }),
    signal: AbortSignal.timeout(120000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `OpenAI ${response.status}`);
  const byPlatform = new Map((parseJsonAnswer(data).results || []).map(result => [String(result.platform).toLowerCase(), result]));
  return platforms.map(platform => {
    const result = byPlatform.get(platform) || { status: "not_found", note: "Nessun risultato restituito", listings: [] };
    const listings = (Array.isArray(result.listings) ? result.listings : []).filter(item =>
      Number(item.price) > 0 && item.currency === "EUR" && /^https?:\/\//.test(item.url || "")
    ).slice(0, 5).map(item => ({ platform, title: String(item.title || ""), price: Number(item.price),
      shipping: Math.max(0, Number(item.shipping) || 0), url: String(item.url),
      relevance: ["exact","high","medium","low"].includes(item.relevance) ? item.relevance : "medium",
      condition: String(item.condition || ""), evidenceType: item.evidenceType === "sold" ? "sold" : "active" }));
    return { platform, status: listings.length ? "found" : (result.status || "not_found"), note: String(result.note || ""), listings };
  });
}

async function api(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/session") {
    return json(res, 200, { authenticated: authenticated(req), configured: Boolean(appUsername && appPassword) });
  }
  if (req.method === "POST" && url.pathname === "/api/session") {
    if (!appUsername || !appPassword) return json(res, 503, { error: "Accesso non configurato nel file .env" });
    const address = req.socket.remoteAddress || "local"; const attempt = loginAttempts.get(address) || { count: 0, reset: 0 };
    if (attempt.reset > Date.now() && attempt.count >= 5) return json(res, 429, { error: "Troppi tentativi. Riprova tra qualche minuto." });
    const input = await body(req);
    if (!equalSecret(input.username, appUsername) || !equalSecret(input.password, appPassword)) {
      loginAttempts.set(address, { count: attempt.reset > Date.now() ? attempt.count + 1 : 1, reset: Date.now() + 5 * 60 * 1000 });
      return json(res, 401, { error: "Username o password errati" });
    }
    loginAttempts.delete(address); const token = randomBytes(32).toString("base64url"); sessions.set(token, Date.now() + SESSION_AGE);
    res.setHeader("Set-Cookie", `prezzo_libri_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_AGE / 1000}`);
    return json(res, 200, { authenticated: true });
  }
  if (req.method === "DELETE" && url.pathname === "/api/session") {
    const token = cookies(req).prezzo_libri_session; if (token) sessions.delete(token);
    res.setHeader("Set-Cookie", "prezzo_libri_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    return json(res, 200, { authenticated: false });
  }
  if (!authenticated(req)) return json(res, 401, { error: "Accesso richiesto" });
  if (req.method === "GET" && url.pathname.startsWith("/api/isbn/")) {
    const isbn = canonicalIsbn(decodeURIComponent(url.pathname.slice(10)));
    if (!isbn) return json(res, 400, { error: "ISBN non valido" });
    const errors = [];
    for (const provider of [lookupGoogle, lookupOpenLibrary]) {
      try { const found = await provider(isbn); if (found) return json(res, 200, found); }
      catch (error) { errors.push(error.message); }
    }
    return json(res, errors.length ? 503 : 404, { error: errors.length ? "Cataloghi temporaneamente non disponibili" : "Libro non trovato", details: errors });
  }
  if (req.method === "GET" && url.pathname === "/api/books") {
    return json(res, 200, q("SELECT * FROM books ORDER BY updated_at DESC").all());
  }
  if (req.method === "POST" && url.pathname === "/api/books") {
    const input = await body(req); const isbn = canonicalIsbn(input.isbn);
    if (!isbn || !String(input.title || "").trim()) return json(res, 400, { error: "ISBN valido e titolo sono obbligatori" });
    q(`INSERT INTO books(isbn,title,authors,publisher,year,cover_url,cover_price,condition,notes)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(isbn) DO UPDATE SET title=excluded.title,authors=excluded.authors,publisher=excluded.publisher,
      year=excluded.year,cover_url=excluded.cover_url,cover_price=excluded.cover_price,condition=excluded.condition,notes=excluded.notes,updated_at=CURRENT_TIMESTAMP`)
      .run(isbn, input.title, input.authors || "", input.publisher || "", input.year || "", input.coverUrl || "", input.coverPrice || null, input.condition || "good", input.notes || "");
    return json(res, 201, q("SELECT * FROM books WHERE isbn=?").get(isbn));
  }
  const bookMatch = url.pathname.match(/^\/api\/books\/(\d+)$/);
  if (req.method === "GET" && bookMatch) {
    const book = q("SELECT * FROM books WHERE id=?").get(Number(bookMatch[1]));
    if (!book) return json(res, 404, { error: "Libro non trovato" });
    const comparables = q("SELECT * FROM comparables WHERE book_id=? ORDER BY observed_at DESC").all(book.id);
    return json(res, 200, { ...book, comparables, links: searchLinks(book), analysis: calculatePrice({ comparables: comparables.map(x => ({...x, evidenceType:x.evidence_type, accepted:Boolean(x.accepted)})), coverPrice: book.cover_price, condition: book.condition }) });
  }
  const compMatch = url.pathname.match(/^\/api\/books\/(\d+)\/comparables$/);
  if (req.method === "POST" && compMatch) {
    const id = Number(compMatch[1]); if (!q("SELECT id FROM books WHERE id=?").get(id)) return json(res, 404, { error: "Libro non trovato" });
    const input = await body(req); if (!(Number(input.price) > 0)) return json(res, 400, { error: "Prezzo non valido" });
    const result = q(`INSERT INTO comparables(book_id,platform,url,title,price,shipping,condition,relevance,evidence_type,accepted)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, input.platform, input.url || "", input.title || "", Number(input.price), Number(input.shipping || 0), input.condition || "", input.relevance || "medium", input.evidenceType || "active", input.accepted === false ? 0 : 1);
    return json(res, 201, q("SELECT * FROM comparables WHERE id=?").get(result.lastInsertRowid));
  }
  const searchMatch = url.pathname.match(/^\/api\/books\/(\d+)\/search-marketplaces$/);
  if (req.method === "POST" && searchMatch) {
    const id = Number(searchMatch[1]);
    const book = q("SELECT * FROM books WHERE id=?").get(id);
    if (!book) return json(res, 404, { error: "Libro non trovato" });
    const results = await searchMarketplaces(book);
    let added = 0;
    for (const result of results) for (const item of result.listings) {
      if (q("SELECT id FROM comparables WHERE book_id=? AND url=?").get(id, item.url)) continue;
      q(`INSERT INTO comparables(book_id,platform,url,title,price,shipping,condition,relevance,evidence_type,accepted)
        VALUES(?,?,?,?,?,?,?,?,?,1)`).run(id, item.platform, item.url, item.title, item.price, item.shipping, item.condition, item.relevance, item.evidenceType);
      added++;
    }
    return json(res, 200, { results, added });
  }
  return json(res, 404, { error: "Risorsa non trovata" });
}

const mime = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".svg":"image/svg+xml" };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    const name = url.pathname === "/" ? "index.html" : normalize(url.pathname.slice(1));
    const path = join(PUBLIC, name);
    if (!path.startsWith(PUBLIC) || !existsSync(path)) return json(res, 404, { error: "Pagina non trovata" });
    res.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream", "Cache-Control":"no-cache" });
    res.end(await readFile(path));
  } catch (error) { console.error(error); json(res, 500, { error: error.message || "Errore interno" }); }
});
server.listen(PORT, HOST, () => console.log(`PrezzoLibri: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`));
