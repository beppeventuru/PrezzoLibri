const config = window.PREZZOLIBRI_CONFIG || {};
const cloudEnabled = Boolean(config.supabaseUrl && config.supabaseAnonKey);
let cloudClient = null;

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

function links(book) {
  const exact = encodeURIComponent(book.isbn); const text = encodeURIComponent(`${book.title} ${book.authors || ""}`.trim());
  return { vinted:`https://www.vinted.it/catalog?search_text=${exact}`, ebay:`https://www.ebay.it/sch/i.html?_nkw=${exact}`,
    abebooks:`https://www.abebooks.it/servlet/SearchResults?isbn=${exact}`, subito:`https://www.subito.it/annunci-italia/vendita/libri-riviste/?q=${exact}`,
    amazon:`https://www.amazon.it/s?k=${exact}`, sold:{ ebay:`https://www.ebay.it/sch/i.html?_nkw=${text}&LH_Sold=1&LH_Complete=1` },
    titleFallback:{ vinted:`https://www.vinted.it/catalog?search_text=${text}`, ebay:`https://www.ebay.it/sch/i.html?_nkw=${text}`, subito:`https://www.subito.it/annunci-italia/vendita/libri-riviste/?q=${text}` } };
}

const relevanceWeight = { exact:1, high:.85, medium:.55, low:.25 };
const evidenceWeight = { sold:1.35, active:.75 };
const marketWeight = { vinted:1, ebay:.9, abebooks:.78, subito:.95, amazon:.82, other:.7 };
function analysis(book, comparables) {
  const accepted = comparables.filter(item => item.accepted !== false && Number(item.price) > 0);
  const values = accepted.map(item => ({ value:(Number(item.price)+Number(item.shipping||0))*(marketWeight[item.platform]||.7), weight:(relevanceWeight[item.relevance]||.55)*(evidenceWeight[item.evidence_type]||.75) })).sort((a,b)=>a.value-b.value);
  let market=null,total=values.reduce((sum,item)=>sum+item.weight,0),current=0; for(const item of values){current+=item.weight;if(current>=total/2){market=item.value;break;}}
  const conditionFactor={new:.72,excellent:.62,good:.5,fair:.35,poor:.2}[book.condition]||.5;
  const local=Number(book.cover_price)>0?Number(book.cover_price)*conditionFactor:null; let recommended=market!=null&&local!=null?market*.7+local*.3:(market??local??5);
  const points=Math.min(60,accepted.length*10)+Math.min(25,accepted.filter(x=>x.relevance==="exact").length*8)+Math.min(15,accepted.filter(x=>x.evidence_type==="sold").length*15);
  const money=value=>Math.max(1,Math.round(value));
  return { quickPrice:money(recommended*.82),recommendedPrice:money(recommended),maximumPrice:money(recommended*1.28),confidence:points>=75?"high":points>=40?"medium":"low",marketMedian:market==null?null:money(market),explanation:accepted.length?`Stima basata su ${accepted.length} confronti, di cui ${accepted.filter(x=>x.evidence_type==="sold").length} vendite concluse.`:"Stima provvisoria basata soltanto su prezzo di copertina e condizioni." };
}

const normalizedComparableText = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it").replace(/\s+/g, " ").trim();
function comparableKey(item) {
  if (item.platform !== "amazon") return `${item.platform}|${item.url}`;
  return ["amazon", item.evidenceType || item.evidence_type || "active", normalizedComparableText(item.title), normalizedComparableText(item.condition), Number(item.price).toFixed(2), Number(item.shipping || 0).toFixed(2)].join("|");
}
async function importMarketplaceResults(db, bookId, results, explicitCoverUrl="") {
  const allowed={vinted:["www.vinted.it","vinted.it"],ebay:["www.ebay.it","ebay.it"],abebooks:["www.abebooks.it","abebooks.it"],subito:["www.subito.it","subito.it"],amazon:["www.amazon.it","amazon.it"]};
  const candidates=(results||[]).flatMap(result=>(result.listings||[]).map(item=>({...item,platform:result.platform}))).filter(item=>{try{return allowed[item.platform]?.includes(new URL(item.url).hostname)&&Number(item.price)>0&&Number(item.price)<100000}catch{return false}});
  const validCoverUrl=value=>{try{const url=new URL(value);return url.protocol==="https:"&&/amazon|ssl-images|abebooks|cloudfront|vinted|amazonaws/i.test(url.hostname)}catch{return false}};
  const coverCandidate=validCoverUrl(explicitCoverUrl)?explicitCoverUrl:["amazon","abebooks","vinted"].flatMap(platform=>candidates.filter(item=>item.platform===platform&&item.coverUrl)).find(item=>validCoverUrl(item.coverUrl))?.coverUrl;
  if(coverCandidate){const {error}=await db.from("books").update({cover_url:coverCandidate,updated_at:new Date().toISOString()}).eq("id",bookId);if(error)throw error;}
  if(candidates.some(item=>item.platform==="amazon"&&/^Usato\s*-/i.test(item.condition||""))){const {error}=await db.from("comparables").delete().eq("book_id",bookId).eq("platform","amazon").ilike("title","%offerta usata più economica%");if(error)throw error;}
  const {data:existingRows,error:existingError}=await db.from("comparables").select("id,platform,url,title,price,shipping,condition,evidence_type,observed_at").eq("book_id",bookId).order("observed_at",{ascending:false});if(existingError)throw existingError;
  const seenAmazon=new Set(),duplicateIds=[];
  for(const row of existingRows||[]){if(row.platform!=="amazon")continue;const key=comparableKey(row);if(seenAmazon.has(key))duplicateIds.push(row.id);else seenAmazon.add(key);}
  if(duplicateIds.length){const {error}=await db.from("comparables").delete().in("id",duplicateIds);if(error)throw error;}
  const existingKeys=new Set((existingRows||[]).filter(row=>!duplicateIds.includes(row.id)).map(comparableKey));
  const candidateKeys=new Set();
  const rows=candidates.filter(item=>{const key=comparableKey(item);if(existingKeys.has(key)||candidateKeys.has(key))return false;candidateKeys.add(key);return true;}).map(item=>({book_id:bookId,platform:item.platform,url:item.url,title:item.title||"",price:Number(item.price),shipping:Math.max(0,Number(item.shipping)||0),condition:item.condition||"",relevance:["exact","high","medium","low"].includes(item.relevance)?item.relevance:"medium",evidence_type:item.evidenceType==="sold"?"sold":"active",accepted:true}));
  if(rows.length){const {error}=await db.from("comparables").insert(rows);if(error)throw error;}
  return {added:rows.length,removedDuplicates:duplicateIds.length,coverSaved:Boolean(coverCandidate),coverUrl:coverCandidate||""};
}

async function fillMissingCovers(db, books) {
  return Promise.all((books||[]).map(async book => {
    if(book.cover_url&&!/books\.google\.com\/books\/content/i.test(book.cover_url))return book;
    try {
      const {data}=await db.functions.invoke("isbn-lookup",{body:{isbn:book.isbn}});
      if(!data?.coverUrl)return book;
      const {error}=await db.from("books").update({cover_url:data.coverUrl,updated_at:new Date().toISOString()}).eq("id",book.id);if(error)throw error;
      return {...book,cover_url:data.coverUrl};
    } catch { return book; }
  }));
}

async function cloudRequest(path, options={}) {
  const db = await client(); const method = options.method || "GET"; const input = JSON.parse(options.body || "{}");
  if (path === "/api/session" && method === "GET") { const { data }=await db.auth.getSession(); return { authenticated:Boolean(data.session), configured:true }; }
  if (path === "/api/session" && method === "POST") { const email=`${String(input.username).trim().toLowerCase()}@prezzolibri.local`; const {error}=await db.auth.signInWithPassword({email,password:input.password}); if(error) throw new Error("Username o password errati"); return {authenticated:true}; }
  if (path === "/api/session" && method === "DELETE") { await db.auth.signOut(); return {authenticated:false}; }
  const isbnMatch=path.match(/^\/api\/isbn\/(.+)$/); if(isbnMatch){const {data,error}=await db.functions.invoke("isbn-lookup",{body:{isbn:decodeURIComponent(isbnMatch[1])}});if(error||data?.error)throw new Error(data?.error||error.message);return data;}
  if(path==="/api/books"&&method==="GET"){const {data:storedBooks,error}=await db.from("books").select("*").order("updated_at",{ascending:false});if(error)throw error;if(!storedBooks?.length)return[];const books=await fillMissingCovers(db,storedBooks);const {data:comparables,error:compError}=await db.from("comparables").select("*").in("book_id",books.map(book=>book.id));if(compError)throw compError;return books.map(book=>({...book,analysis:analysis(book,(comparables||[]).filter(item=>item.book_id===book.id))}));}
  if(path==="/api/books"&&method==="POST"){const {data:{user}}=await db.auth.getUser();const row={user_id:user.id,isbn:input.isbn,title:input.title,authors:input.authors||"",publisher:input.publisher||"",year:input.year||"",cover_url:input.coverUrl||"",cover_price:input.coverPrice||null,condition:input.condition||"good",notes:input.notes||"",updated_at:new Date().toISOString()};const {data,error}=await db.from("books").upsert(row,{onConflict:"user_id,isbn"}).select().single();if(error)throw error;return data;}
  const bookMatch=path.match(/^\/api\/books\/(\d+)$/);if(bookMatch&&method==="GET"){const {data:storedBook,error}=await db.from("books").select("*").eq("id",bookMatch[1]).single();if(error)throw error;const [book]=await fillMissingCovers(db,[storedBook]);const {data:comparables,error:compError}=await db.from("comparables").select("*").eq("book_id",book.id).order("observed_at",{ascending:false});if(compError)throw compError;return {...book,comparables,links:links(book),analysis:analysis(book,comparables)};}
  const compMatch=path.match(/^\/api\/books\/(\d+)\/comparables$/);if(compMatch&&method==="POST"){const row={book_id:Number(compMatch[1]),platform:input.platform,url:input.url||"",title:input.title||"",price:Number(input.price),shipping:Number(input.shipping||0),condition:input.condition||"",relevance:input.relevance||"medium",evidence_type:input.evidenceType||"active",accepted:input.accepted!==false};const {data,error}=await db.from("comparables").insert(row).select().single();if(error)throw error;return data;}
  const deleteCompMatch=path.match(/^\/api\/comparables\/(\d+)$/);if(deleteCompMatch&&method==="DELETE"){const {error}=await db.from("comparables").delete().eq("id",Number(deleteCompMatch[1]));if(error)throw error;return{deleted:true};}
  const importMatch=path.match(/^\/api\/books\/(\d+)\/import-marketplaces$/);if(importMatch&&method==="POST")return importMarketplaceResults(db,Number(importMatch[1]),input.results,input.coverUrl);
  const searchMatch=path.match(/^\/api\/books\/(\d+)\/search-marketplaces$/);if(searchMatch&&method==="POST"){const {data:book,error:bookError}=await db.from("books").select("*").eq("id",searchMatch[1]).single();if(bookError)throw bookError;const {data,error}=await db.functions.invoke("marketplace-search",{body:{book}});if(error||data?.error)throw new Error(data?.error||error.message);const imported=await importMarketplaceResults(db,book.id,data.results);return {results:data.results,...imported};}
  throw new Error("Risorsa non trovata");
}

export const isCloud = cloudEnabled;
export const request = (path, options) => cloudEnabled ? cloudRequest(path, options) : localRequest(path, options);
