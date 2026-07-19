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

function analysis(book, comparables) {
  const accepted = comparables.filter(item => item.accepted !== false && Number(item.price) > 0 && !/^\s*nuov/i.test(String(item.condition||"")));
  const median=values=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2};
  const percentile=(values,position)=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),index=(sorted.length-1)*position,lower=Math.floor(index),fraction=index-lower;return sorted[lower+1]==null?sorted[lower]:sorted[lower]+fraction*(sorted[lower+1]-sorted[lower])};
  const robustPrices=items=>{const prices=items.map(item=>Number(item.price)).filter(price=>price>0);if(prices.length<4)return prices;const logs=prices.map(Math.log),q1=percentile(logs,.25),q3=percentile(logs,.75),spread=q3-q1,lower=q1-1.5*spread,upper=q3+1.5*spread,filtered=prices.filter(price=>Math.log(price)>=lower&&Math.log(price)<=upper);return filtered.length?filtered:prices};
  const center=items=>median(robustPrices(items)),upper=items=>percentile(robustPrices(items),.75),evidence=item=>item.evidence_type||item.evidenceType||"active";
  const reliable=accepted.filter(item=>item.relevance!=="low"&&item.relevance!=="medium"),usable=reliable.length?reliable:accepted.filter(item=>item.relevance!=="low");
  const providers=[...new Set(accepted.map(item=>String(item.platform||"other").toLowerCase()))],group=(platform,type="active")=>usable.filter(item=>String(item.platform||"other").toLowerCase()===platform&&evidence(item)===type),usedPreferred=platform=>{const all=group(platform),used=all.filter(item=>/usato|buon|ottim|accettabil|seconda mano/i.test(String(item.condition||"")));return used.length?used:all};
  const sold=usable.filter(item=>evidence(item)==="sold"),vinted=group("vinted"),ebay=group("ebay"),subito=group("subito"),libraccio=usedPreferred("libraccio"),ibs=usedPreferred("ibs"),amazon=usedPreferred("amazon"),abebooks=usedPreferred("abebooks");
  const soldCenter=center(sold),vintedCenter=center(vinted),ebayCenter=center(ebay),subitoCenter=center(subito),libraccioCenter=center(libraccio),ibsCenter=center(ibs),amazonCenter=center(amazon),abeCenter=center(abebooks);
  let market=null,basis="prezzo di copertina e condizioni";
  if(soldCenter!=null&&vintedCenter!=null){if(vintedCenter<soldCenter/2){market=vintedCenter;basis="annunci Vinted (mercato distinto dalle vendite eBay)"}else if(vintedCenter>soldCenter*2){if(sold.length===1){const activeCenters=[vintedCenter,ebayCenter,subitoCenter,libraccioCenter].filter(value=>value!=null),activeConsensus=Math.min(vintedCenter,median(activeCenters)??vintedCenter);market=activeConsensus*.85+soldCenter*.15;basis="annunci attivi concordanti, con una sola vendita eBay usata come correttivo"}else{market=soldCenter;basis="vendite concluse eBay (annunci Vinted anomali)"}}else{market=Math.min(vintedCenter,soldCenter*(sold.length>=2?1.05:1.2));basis="vendite concluse eBay, verificate sugli annunci Vinted"}}
  else if(soldCenter!=null){market=soldCenter;basis="vendite concluse eBay"}
  else if(vintedCenter!=null){market=vintedCenter;basis="annunci Vinted"}
  else if(libraccioCenter!=null){market=libraccioCenter*.9;basis="prezzi usati Libraccio, adattati alla vendita tra privati su Vinted"}
  else if(ebayCenter!=null){market=ebayCenter*.9;basis="annunci eBay, ridotti perché non ancora venduti"}
  else if(subitoCenter!=null){market=subitoCenter*.9;basis="annunci Subito, ridotti perché non ancora venduti"}
  else{const secondary=[ibsCenter,amazonCenter,abeCenter].filter(value=>value!=null);if(secondary.length){market=Math.min(...secondary)*.75;basis="prezzo più prudente tra IBS, Amazon e AbeBooks"}}
  const sourceCenters=[soldCenter,vintedCenter,ebayCenter,subitoCenter,libraccioCenter,ibsCenter,amazonCenter,abeCenter].filter(value=>value!=null&&value>0),spreadRatio=sourceCenters.length>=2?Math.max(...sourceCenters)/Math.min(...sourceCenters):1,disagreement=spreadRatio>2;
  const targetFactor={new:1.12,excellent:1.05,good:1,fair:.8,poor:.55}[book.condition]||1,coverFactor={new:.72,excellent:.62,good:.5,fair:.35,poor:.2}[book.condition]||.5,local=Number(book.cover_price)>0?Number(book.cover_price)*coverFactor:null,unadjusted=market??local??5,recommended=market==null?unadjusted:unadjusted*targetFactor;
  const targetUpper=upper(vinted)??upper(sold)??upper(libraccio)??upper(ebay)??upper(subito),maximumBase=targetUpper==null?recommended*1.25:Math.max(recommended,targetUpper*targetFactor),maximum=Math.min(maximumBase,recommended*(disagreement?1.25:1.5));
  let confidence="low";if(!disagreement&&sold.length>=3&&vinted.length>=1)confidence="high";else if(!disagreement&&(sold.length>=1||vinted.length>=2))confidence="medium";
  const money=value=>Math.max(1,Math.round(value)),warning=disagreement?` I mercati sono molto discordanti (il più alto è ${spreadRatio.toFixed(1)} volte il più basso), quindi non sono stati mediati.`:"";
  return {quickPrice:money(recommended*.85),recommendedPrice:money(recommended),maximumPrice:money(maximum),confidence,marketMedian:market==null?null:money(market),marketplaceCount:providers.length,disagreement,spreadRatio,basis,explanation:accepted.length?`Stima basata principalmente su ${basis}. Considerati ${accepted.length} confronti, di cui ${accepted.filter(item=>evidence(item)==="sold").length} vendite concluse.${warning}`:"Stima provvisoria basata soltanto su prezzo di copertina e condizioni."};
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
  const isbnMatch=path.match(/^\/api\/isbn\/(.+)$/); if(isbnMatch){
    const isbn=decodeURIComponent(isbnMatch[1]);let serverError;
    try{const {data,error}=await db.functions.invoke("isbn-lookup",{body:{isbn}});if(!error&&!data?.error)return data;serverError=new Error(data?.error||error?.message||"Ricerca ISBN non disponibile");}catch(error){serverError=error;}
    try{return await directIsbnLookup(isbn)}catch{throw serverError;}
  }
  if(path==="/api/books"&&method==="GET"){const {data:books,error}=await db.from("books").select("*").order("updated_at",{ascending:false});if(error)throw error;if(!books?.length)return[];const {data:comparables,error:compError}=await db.from("comparables").select("*").in("book_id",books.map(book=>book.id));if(compError)throw compError;return books.map(book=>({...book,analysis:analysis(book,(comparables||[]).filter(item=>item.book_id===book.id))}));}
  if(path==="/api/books"&&method==="POST"){const {data:{user}}=await db.auth.getUser();const row={user_id:user.id,isbn:input.isbn,title:input.title,authors:input.authors||"",publisher:input.publisher||"",year:input.year||"",cover_url:input.coverUrl||"",cover_price:input.coverPrice||null,condition:input.condition||"good",notes:input.notes||"",updated_at:new Date().toISOString()};const {data,error}=await db.from("books").upsert(row,{onConflict:"user_id,isbn"}).select().single();if(error)throw error;return data;}
  const bookMatch=path.match(/^\/api\/books\/(\d+)$/);if(bookMatch&&method==="GET"){const {data:book,error}=await db.from("books").select("*").eq("id",bookMatch[1]).single();if(error)throw error;const {data:comparables,error:compError}=await db.from("comparables").select("*").eq("book_id",book.id).order("observed_at",{ascending:false});if(compError)throw compError;return {...book,comparables,links:links(book),analysis:analysis(book,comparables)};}
  const compMatch=path.match(/^\/api\/books\/(\d+)\/comparables$/);if(compMatch&&method==="POST"){const row={book_id:Number(compMatch[1]),platform:input.platform,url:input.url||"",title:input.title||"",price:Number(input.price),shipping:Number(input.shipping||0),condition:input.condition||"",relevance:input.relevance||"medium",evidence_type:input.evidenceType||"active",date_label:input.dateLabel||"",accepted:input.accepted!==false};const {data,error}=await db.from("comparables").insert(row).select().single();if(error)throw error;return data;}
  const deleteCompMatch=path.match(/^\/api\/comparables\/(\d+)$/);if(deleteCompMatch&&method==="DELETE"){const {error}=await db.from("comparables").delete().eq("id",Number(deleteCompMatch[1]));if(error)throw error;return{deleted:true};}
  const importMatch=path.match(/^\/api\/books\/(\d+)\/import-marketplaces$/);if(importMatch&&method==="POST")return importMarketplaceResults(db,Number(importMatch[1]),input.results,input.coverUrl);
  const searchMatch=path.match(/^\/api\/books\/(\d+)\/search-marketplaces$/);if(searchMatch&&method==="POST"){const {data:book,error:bookError}=await db.from("books").select("*").eq("id",searchMatch[1]).single();if(bookError)throw bookError;const {data,error}=await db.functions.invoke("marketplace-search",{body:{book}});if(error||data?.error)throw new Error(data?.error||error.message);const imported=await importMarketplaceResults(db,book.id,data.results);return {results:data.results,...imported};}
  throw new Error("Risorsa non trovata");
}

export const isCloud = cloudEnabled;
export const request = (path, options) => cloudEnabled ? cloudRequest(path, options) : localRequest(path, options);
