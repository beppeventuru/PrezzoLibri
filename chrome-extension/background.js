const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const encode=value=>encodeURIComponent(value);
function tasks(book){const text=`${book.title} ${book.authors||""}`.trim();return[
  {platform:"vinted",url:`https://www.vinted.it/catalog?search_text=${encode(book.isbn)}`},
  {platform:"ebay",url:`https://www.ebay.it/sch/i.html?_nkw=${encode(book.isbn)}`},
  {platform:"ebay",url:`https://www.ebay.it/sch/i.html?_nkw=${encode(text)}&LH_Sold=1&LH_Complete=1`,sold:true},
  {platform:"abebooks",url:`https://www.abebooks.it/servlet/SearchResults?isbn=${encode(book.isbn)}`},
  {platform:"subito",url:`https://www.subito.it/annunci-italia/vendita/libri-riviste/?q=${encode(book.isbn)}`},
  {platform:"amazon",url:`https://www.amazon.it/s?k=${encode(book.isbn)}`}
];}
function loaded(tabId){return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(listener);reject(new Error("Tempo scaduto"));},30000);const listener=(id,info)=>{if(id===tabId&&info.status==="complete"){clearTimeout(timeout);chrome.tabs.onUpdated.removeListener(listener);resolve();}};chrome.tabs.onUpdated.addListener(listener);});}
async function scrape(task,book){let tab;try{tab=await chrome.tabs.create({url:task.url,active:false});if(tab.status!=="complete")await loaded(tab.id);await wait(1400);let response;for(let attempt=0;attempt<3;attempt++){try{response=await chrome.tabs.sendMessage(tab.id,{type:"PREZZOLIBRI_SCRAPE",platform:task.platform,sold:Boolean(task.sold),isbn:book.isbn});break;}catch{await wait(700);}}return response?.listings||[];}catch{return [];}finally{if(tab?.id)await chrome.tabs.remove(tab.id).catch(()=>{});}}
chrome.runtime.onConnect.addListener(port=>{if(port.name!=="prezzolibri-collection")return;port.onMessage.addListener(async message=>{if(message.type!=="START")return;const all=[],work=tasks(message.book);for(let i=0;i<work.length;i++){port.postMessage({type:"PROGRESS",message:`Apro ${work[i].platform}: ricerca ${i+1} di ${work.length}…`});const listings=await scrape(work[i],message.book);all.push(...listings);port.postMessage({type:"PARTIAL",platform:work[i].platform,count:listings.length});}const platforms=["vinted","ebay","abebooks","subito","amazon"];const results=platforms.map(platform=>({platform,status:all.some(x=>x.platform===platform)?"found":"not_found",note:"Risultati letti dalla tua sessione Chrome.",listings:all.filter(x=>x.platform===platform)}));port.postMessage({type:"COMPLETE",isbn:message.book.isbn,results});});});
