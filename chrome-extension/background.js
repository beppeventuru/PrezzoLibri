const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const encode=value=>encodeURIComponent(value);
const normalized=value=>String(value||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("it");
function relevantToBook(item,book){
  const haystack=normalized(item.title);
  const ignored=new Set(["della","delle","degli","come","libro","edizione","sono","alla","nelle"]);
  const titleTokens=[...new Set(normalized(book.title).match(/[a-z0-9]{4,}/g)||[])].filter(token=>!ignored.has(token));
  const authorTokens=[...new Set(normalized(book.authors||"").match(/[a-z0-9]{4,}/g)||[])].filter(token=>!ignored.has(token));
  const titleMatches=titleTokens.filter(token=>haystack.includes(token)).length;
  const authorMatches=authorTokens.filter(token=>haystack.includes(token)).length;
  // Titoli generici come "Ragazza con paesaggio" generano quadri, stampe e
  // figurine. Per una ricerca testuale eBay richiediamo anche l'autore.
  return titleMatches>=Math.min(2,titleTokens.length||1)&&(!authorTokens.length||authorMatches>=1);
}
function isbn13to10(isbn){if(!/^978\d{10}$/.test(isbn))return"";const core=isbn.slice(3,12);let sum=0;for(let i=0;i<9;i++)sum+=Number(core[i])*(10-i);const check=(11-sum%11)%11;return core+(check===10?"X":check);}
function tasks(book){const text=`${book.title} ${book.authors||""}`.trim(),asin=isbn13to10(book.isbn);return[
  {platform:"vinted",url:`https://www.vinted.it/catalog?search_text=${encode(book.isbn)}`},
  {platform:"vinted",url:`https://www.vinted.it/catalog?search_text=${encode(text)}`,fallback:true},
  {platform:"ebay",url:`https://www.ebay.it/sch/i.html?_nkw=${encode(book.isbn)}`},
  {platform:"ebay",url:`https://www.ebay.it/sch/i.html?_nkw=${encode(text)}`,fallback:true},
  {platform:"ebay",url:`https://www.ebay.it/sch/i.html?_nkw=${encode(text)}&LH_Sold=1&LH_Complete=1`,sold:true,fallback:true},
  {platform:"abebooks",url:`https://www.abebooks.it/servlet/SearchResults?isbn=${encode(book.isbn)}`},
  {platform:"abebooks",url:`https://www.abebooks.it/servlet/SearchResults?kn=${encode(text)}`,fallback:true},
  {platform:"subito",url:`https://www.subito.it/annunci-italia/vendita/libri-riviste/?q=${encode(book.isbn)}`},
  {platform:"subito",url:`https://www.subito.it/annunci-italia/vendita/libri-riviste/?q=${encode(text)}`,fallback:true},
  {platform:"libraccio",url:"https://www.libraccio.it/",mode:"search"},
  {platform:"ibs",url:`https://www.ibs.it/search/?ts=as&query=${encode(book.isbn)}`},
  {platform:"amazon",url:`https://www.amazon.it/s?k=${encode(book.isbn)}`,mode:"search"},
  {platform:"amazon",url:`https://www.amazon.it/s?k=${encode(text)}`,mode:"search",fallback:true},
  {platform:"amazon",url:`https://www.amazon.it/dp/${asin}`,mode:"offers",active:false}
];}
function loaded(tabId){return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(listener);reject(new Error("Tempo scaduto"));},30000);const listener=(id,info)=>{if(id===tabId&&info.status==="complete"){clearTimeout(timeout);chrome.tabs.onUpdated.removeListener(listener);resolve();}};chrome.tabs.onUpdated.addListener(listener);});}
async function scrape(task,book){let tab;try{tab=await chrome.tabs.create({url:task.url,active:Boolean(task.active)});if(tab.status!=="complete")await loaded(tab.id);await wait(task.mode==="offers"?3000:1800);if(task.platform==="libraccio"&&task.mode==="search"){const nextPage=loaded(tab.id);const navigation=await chrome.tabs.sendMessage(tab.id,{type:"PREZZOLIBRI_NAVIGATE_LIBRACCIO",isbn:book.isbn});if(!navigation?.started)throw new Error("Ricerca Libraccio non disponibile");await nextPage;await wait(1800);}let response;for(let attempt=0;attempt<3;attempt++){try{response=await chrome.tabs.sendMessage(tab.id,{type:"PREZZOLIBRI_SCRAPE",platform:task.platform,mode:task.mode,sold:Boolean(task.sold),isbn:book.isbn,title:book.title,authors:book.authors});break;}catch{await wait(700);}}return{listings:response?.listings||[],diagnostics:response?.diagnostics||null};}catch(error){return{listings:[],diagnostics:{error:error?.message||"Errore scheda"}};}finally{if(tab?.id)await chrome.tabs.remove(tab.id).catch(()=>{});}}
chrome.runtime.onConnect.addListener(port=>{
  if(port.name!=="prezzolibri-collection")return;
  port.onMessage.addListener(async message=>{
    if(message.type!=="START")return;
    const all=[],diagnostics={},logs=[],work=tasks(message.book);
    let coverUrl="";
    for(let i=0;i<work.length;i++){
      port.postMessage({type:"PROGRESS",message:`Apro ${work[i].platform}: ricerca ${i+1} di ${work.length}…`});
      const packet=await scrape(work[i],message.book);
      const rawListings=work[i].fallback?packet.listings.filter(item=>relevantToBook(item,message.book)).map(item=>({...item,relevance:item.relevance==="exact"?"high":item.relevance})):packet.listings;
      // AbeBooks ha talvolta esposto il prezzo del libro anche nel campo
      // spedizione. Non salviamo un costo palesemente duplicato.
      const listings=rawListings.map(item=>item.platform==="abebooks"&&Math.abs(Number(item.shipping)-Number(item.price))<.01?{...item,shipping:0}:item);
      all.push(...listings);
      const listingCover=listings.find(item=>item.coverUrl)?.coverUrl;
      if(work[i].platform==="amazon"&&listingCover)coverUrl=listingCover;
      if(packet.diagnostics){
        diagnostics[work[i].platform]=packet.diagnostics;
        logs.push({step:i+1,task:work[i],count:listings.length,rawCount:packet.listings.length,...packet.diagnostics});
        if(work[i].platform==="amazon"&&packet.diagnostics.coverUrl)coverUrl=packet.diagnostics.coverUrl;
      }
      port.postMessage({type:"PARTIAL",platform:work[i].platform,count:listings.length});
    }
    const seen=new Set();
    const uniqueAll=all.filter(item=>{
      const key=`${item.platform}|${item.evidenceType||"active"}|${item.url}`;
      if(seen.has(key))return false;
      seen.add(key);
      return true;
    });
    const platforms=["vinted","ebay","abebooks","subito","libraccio","ibs","amazon"],extensionVersion=chrome.runtime.getManifest().version;
    const results=platforms.map(platform=>{
      const d=diagnostics[platform];
      const note=d?d.error?`Diagnostica: ${d.error}.`:`Risultati letti dalla tua sessione Chrome (${d.results??0}).`:"Risultati letti dalla tua sessione Chrome.";
      return{platform,status:uniqueAll.some(x=>x.platform===platform)?"found":"not_found",note,listings:uniqueAll.filter(x=>x.platform===platform)};
    });
    logs.push({stage:"trasporto estensione → app",extensionVersion,resultsBeforeDeduplication:all.length,resultsAfterDeduplication:uniqueAll.length,coverFound:Boolean(coverUrl),coverUrl});
    port.postMessage({type:"COMPLETE",isbn:message.book.isbn,results,logs,coverUrl,extensionVersion});
  });
});
