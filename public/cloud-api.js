import { calculatePrice } from "./pricing.js";

const config = window.PREZZOLIBRI_CONFIG || {};
const cloudEnabled = Boolean(config.supabaseUrl && config.supabaseAnonKey);
let cloudClient = null;
const ANALYSIS_VERSION = 2;

async function client() {
  if (!cloudEnabled) return null;
  if (!cloudClient) {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    cloudClient = createClient(config.supabaseUrl, config.supabaseAnonKey);
  }
  return cloudClient;
}

async function localRequest(path, options) {
  const response = await fetch(path, { ...options, headers:{ "Content-Type":"application/json", ...(options?.headers || {}) } });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || "Errore"); return data;
}

async function directIsbnLookup(isbn) {
  let googleStatus = "non raggiungibile", openStatus = "non raggiungibile";
  try {
    const google = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=1&projection=full`);
    googleStatus = google.status;
    if (google.ok) {
      const item = (await google.json()).items?.[0];
      if (item) {
        const volume = item.volumeInfo || {};
        return { isbn, title:volume.title || "", authors:(volume.authors || []).join(", "), publisher:volume.publisher || "", year:String(volume.publishedDate || "").slice(0,4), coverUrl:volume.imageLinks?.thumbnail?.replace("http:","https:") || "", coverPrice:item.saleInfo?.listPrice?.currencyCode === "EUR" ? item.saleInfo.listPrice.amount : null, source:"Google Books (ricerca diretta)" };
      }
    }
  } catch {}
  try {
    const open = await fetch(`https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&limit=1`);
    openStatus = open.status;
    const item = open.ok ? (await open.json()).docs?.[0] : null;
    if (item) return { isbn, title:item.title || "", authors:(item.author_name || []).join(", "), publisher:item.publisher?.[0] || "", year:String(item.first_publish_year || ""), coverUrl:item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg` : "", coverPrice:null, source:"Open Library (ricerca diretta)" };
  } catch {}
  throw new Error(`Libro non trovato nei cataloghi disponibili (Google Books ${googleStatus}, Open Library ${openStatus})`);
}

function links(book) {
  const exact = encodeURIComponent(book.isbn); const text = encodeURIComponent(`${book.title} ${book.authors || ""}`.trim());
  return { vinted:`https://www.vinted.it/catalog?search_text=${exact}`, ebay:`https://www.ebay.it/sch/i.html?_nkw=${exact}`,
    abebooks:`https://www.abebooks.it/servlet/SearchResults?isbn=${exact}`, subito:`https://www.subito.it/annunci-italia/vendita/libri-riviste/?q=${exact}`,
    libraccio:`https://www.libraccio.it/`, ibs:`https://www.ibs.it/search/?ts=as&query=${exact}`,
    amazon:`https://www.amazon.it/s?k=${exact}`, sold:{ ebay:`https://www.ebay.it/sch/i.html?_nkw=${text}&LH_Sold=1&LH_Complete=1` },
    titleFallback:{ vinted:`https://www.vinted.it/catalog?search_text=${text}`, ebay:`https://www.ebay.it/sch/i.html?_nkw=${text}`, subito:`https://www.subito.it/annunci-italia/vendita/libri-riviste/?q=${text}` } };
}

const analysis = (book, comparables) => calculatePrice({
  comparables,
  coverPrice:book.cover_price,
  condition:book.condition
});

const cachedAnalysis = book => Number(book.analysis_version) === ANALYSIS_VERSION && book.analysis_cache?.recommendedPrice != null
  ? book.analysis_cache
  : null;

async function saveAnalysisCache(db, book, comparables) {
  const value = analysis(book, comparables || []);
  const { error } = await db.from("books").update({ analysis_cache:value, analysis_version:ANALYSIS_VERSION }).eq("id", book.id);
  if (error) throw error;
  book.analysis_cache = value;
  book.analysis_version = ANALYSIS_VERSION;
  return value;
}

async function refreshBookAnalysis(db, bookId) {
  const { data:book, error:bookError } = await db.from("books").select("*").eq("id", bookId).single();
  if (bookError) throw bookError;
  const { data:comparables, error:comparablesError } = await db.from("comparables").select("*").eq("book_id", bookId);
  if (comparablesError) throw comparablesError;
  return saveAnalysisCache(db, book, comparables || []);
}

const normalizedComparableText = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it").replace(/\s+/g, " ").trim();
function comparableKey(item) {
  if (item.platform !== "amazon") return `${item.platform}|${item.url}`;
  return ["amazon", item.evidenceType || item.evidence_type || "active", normalizedComparableText(item.title), normalizedComparableText(item.condition), Number(item.price).toFixed(2), Number(item.shipping || 0).toFixed(2)].join("|");
}
async function importMarketplaceResults(db, bookId, results, explicitCoverUrl="") {
  const allowed={vinted:["www.vinted.it","vinted.it"],ebay:["www.ebay.it","ebay.it"],abebooks:["www.abebooks.it","abebooks.it"],subito:["www.subito.it","subito.it"],libraccio:["www.libraccio.it","libraccio.it"],ibs:["www.ibs.it","ibs.it"],amazon:["www.amazon.it","amazon.it"]};
  const allCandidates=(results||[]).flatMap(result=>(result.listings||[]).map(item=>({...item,platform:result.platform}))).filter(item=>{try{return allowed[item.platform]?.includes(new URL(item.url).hostname)&&Number(item.price)>0&&Number(item.price)<100000}catch{return false}});
  const candidates=allCandidates.filter(item=>!/^\s*nuov/i.test(String(item.condition||"")));
  const validCoverUrl=value=>{try{const url=new URL(value);return url.protocol==="https:"&&/amazon|ssl-images|abebooks|cloudfront|vinted|amazonaws/i.test(url.hostname)}catch{return false}};
  const coverCandidate=validCoverUrl(explicitCoverUrl)?explicitCoverUrl:["amazon","abebooks","vinted"].flatMap(platform=>allCandidates.filter(item=>item.platform===platform&&item.coverUrl)).find(item=>validCoverUrl(item.coverUrl))?.coverUrl;
  if(coverCandidate){const {error}=await db.from("books").update({cover_url:coverCandidate,updated_at:new Date().toISOString()}).eq("id",bookId);if(error)throw error;}
  if(candidates.some(item=>item.platform==="amazon"&&/^Usato\s*-/i.test(item.condition||""))){const {error}=await db.from("comparables").delete().eq("book_id",bookId).eq("platform","amazon").ilike("title","%offerta usata più economica%");if(error)throw error;}
  const {data:existingRows,error:existingError}=await db.from("comparables").select("id,platform,url,title,price,shipping,condition,evidence_type,date_label,observed_at").eq("book_id",bookId).order("observed_at",{ascending:false});if(existingError)throw existingError;
  const existingByKey=new Map((existingRows||[]).map(row=>[comparableKey(row),row]));
  for(const item of candidates.filter(item=>item.dateLabel)){
    const existing=existingByKey.get(comparableKey(item));
    if(!existing||existing.date_label===item.dateLabel)continue;
    const {error}=await db.from("comparables").update({date_label:item.dateLabel}).eq("id",existing.id);if(error)throw error;
    existing.date_label=item.dateLabel;
  }
  const seenAmazon=new Set(),duplicateIds=[];
  for(const row of existingRows||[]){if(row.platform!=="amazon")continue;const key=comparableKey(row);if(seenAmazon.has(key))duplicateIds.push(row.id);else seenAmazon.add(key);}
  if(duplicateIds.length){const {error}=await db.from("comparables").delete().in("id",duplicateIds);if(error)throw error;}
  const existingKeys=new Set((existingRows||[]).filter(row=>!duplicateIds.includes(row.id)).map(comparableKey));
  const candidateKeys=new Set();
  const rows=candidates.filter(item=>{const key=comparableKey(item);if(existingKeys.has(key)||candidateKeys.has(key))return false;candidateKeys.add(key);return true;}).map(item=>({book_id:bookId,platform:item.platform,url:item.url,title:item.title||"",price:Number(item.price),shipping:Math.max(0,Number(item.shipping)||0),condition:item.condition||"",relevance:["exact","high","medium","low"].includes(item.relevance)?item.relevance:"medium",evidence_type:item.evidenceType==="sold"?"sold":"active",date_label:item.dateLabel||"",accepted:true}));
  if(rows.length){const {error}=await db.from("comparables").insert(rows);if(error)throw error;}
  await refreshBookAnalysis(db, bookId);
  return {added:rows.length,removedDuplicates:duplicateIds.length,coverSaved:Boolean(coverCandidate),coverUrl:coverCandidate||""};
}

async function allComparablesForBooks(db, bookIds) {
  const rows = [], pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db.from("comparables").select("*").in("book_id", bookIds).range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function cloudRequest(path, options={}) {
  const db = await client(); const method = options.method || "GET"; const input = JSON.parse(options.body || "{}");
  if (path === "/api/session" && method === "GET") { const { data }=await db.auth.getSession(); return { authenticated:Boolean(data.session), configured:true }; }
  if (path === "/api/session" && method === "POST") { const email=`${String(input.username).trim().toLowerCase()}@prezzolibri.local`; const {error}=await db.auth.signInWithPassword({email,password:input.password}); if(error) throw new Error("Username o password errati"); return {authenticated:true}; }
  if (path === "/api/session" && method === "DELETE") { await db.auth.signOut(); return {authenticated:false}; }
  const isbnMatch=path.match(/^\/api\/isbn\/(.+)$/); if(isbnMatch){
    const isbn=decodeURIComponent(isbnMatch[1]);let serverError;
    const {data:savedBook}=await db.from("books").select("isbn,title,authors,publisher,year,cover_url,cover_price").eq("isbn",isbn).maybeSingle();
    if(savedBook?.title)return{isbn:savedBook.isbn,title:savedBook.title,authors:savedBook.authors||"",publisher:savedBook.publisher||"",year:savedBook.year||"",coverUrl:savedBook.cover_url||"",coverPrice:savedBook.cover_price??null,source:"archivio PrezzoLibri"};
    try{const {data,error}=await db.functions.invoke("isbn-lookup",{body:{isbn}});if(!error&&!data?.error)return{...data,source:data.source||"cataloghi ISBN"};serverError=new Error(data?.error||error?.message||"Ricerca ISBN non disponibile");}catch(error){serverError=error;}
    try{return await directIsbnLookup(isbn)}catch{throw serverError;}
  }
  if(path==="/api/books"&&method==="GET"){
    const {data:books,error}=await db.from("books").select("*").order("updated_at",{ascending:false});if(error)throw error;if(!books?.length)return[];
    const missing=books.filter(book=>!cachedAnalysis(book));
    if(missing.length){
      const comparables=await allComparablesForBooks(db,missing.map(book=>book.id)),byBook=new Map();
      for(const item of comparables){if(!byBook.has(item.book_id))byBook.set(item.book_id,[]);byBook.get(item.book_id).push(item);}
      for(let index=0;index<missing.length;index+=8){
        await Promise.all(missing.slice(index,index+8).map(book=>saveAnalysisCache(db,book,byBook.get(book.id)||[])));
      }
    }
    return books.map(book=>({...book,analysis:cachedAnalysis(book)}));
  }
  if(path==="/api/books"&&method==="POST"){const {data:{user}}=await db.auth.getUser();const row={user_id:user.id,isbn:input.isbn,title:input.title,authors:input.authors||"",publisher:input.publisher||"",year:input.year||"",cover_url:input.coverUrl||"",cover_price:input.coverPrice||null,condition:input.condition||"good",notes:input.notes||"",analysis_cache:null,analysis_version:0,updated_at:new Date().toISOString()};const {data,error}=await db.from("books").upsert(row,{onConflict:"user_id,isbn"}).select().single();if(error)throw error;return data;}
  const bookMatch=path.match(/^\/api\/books\/(\d+)$/);if(bookMatch&&method==="GET"){const {data:book,error}=await db.from("books").select("*").eq("id",bookMatch[1]).single();if(error)throw error;const {data:comparables,error:compError}=await db.from("comparables").select("*").eq("book_id",book.id).order("observed_at",{ascending:false});if(compError)throw compError;const currentAnalysis=cachedAnalysis(book)||await saveAnalysisCache(db,book,comparables||[]);return {...book,comparables,links:links(book),analysis:currentAnalysis};}
  const compMatch=path.match(/^\/api\/books\/(\d+)\/comparables$/);if(compMatch&&method==="POST"){const bookId=Number(compMatch[1]);const row={book_id:bookId,platform:input.platform,url:input.url||"",title:input.title||"",price:Number(input.price),shipping:Number(input.shipping||0),condition:input.condition||"",relevance:input.relevance||"medium",evidence_type:input.evidenceType||"active",date_label:input.dateLabel||"",accepted:input.accepted!==false};const {data,error}=await db.from("comparables").insert(row).select().single();if(error)throw error;await refreshBookAnalysis(db,bookId);return data;}
  const deleteCompMatch=path.match(/^\/api\/comparables\/(\d+)$/);if(deleteCompMatch&&method==="DELETE"){const comparableId=Number(deleteCompMatch[1]);const {data:comparable,error:lookupError}=await db.from("comparables").select("book_id").eq("id",comparableId).single();if(lookupError)throw lookupError;const {error}=await db.from("comparables").delete().eq("id",comparableId);if(error)throw error;await refreshBookAnalysis(db,comparable.book_id);return{deleted:true};}
  const importMatch=path.match(/^\/api\/books\/(\d+)\/import-marketplaces$/);if(importMatch&&method==="POST")return importMarketplaceResults(db,Number(importMatch[1]),input.results,input.coverUrl);
  const searchMatch=path.match(/^\/api\/books\/(\d+)\/search-marketplaces$/);if(searchMatch&&method==="POST"){const {data:book,error:bookError}=await db.from("books").select("*").eq("id",searchMatch[1]).single();if(bookError)throw bookError;const {data,error}=await db.functions.invoke("marketplace-search",{body:{book}});if(error||data?.error)throw new Error(data?.error||error.message);const imported=await importMarketplaceResults(db,book.id,data.results);return {results:data.results,...imported};}
  throw new Error("Risorsa non trovata");
}

export const isCloud = cloudEnabled;
export const request = (path, options) => cloudEnabled ? cloudRequest(path, options) : localRequest(path, options);
