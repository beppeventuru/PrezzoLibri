const ports=new Map();
function startCollection(sendResponse=()=>{},providedBook){
  const isbn=providedBook?.isbn||document.querySelector("#bookIsbn")?.value;
  const title=providedBook?.title||document.querySelector("#title")?.value;
  const authors=providedBook?.authors||document.querySelector("#authors")?.value||"";
  if(!isbn||!title){sendResponse({ok:false,error:"Apri e salva prima il libro da valutare."});return;}
  if(ports.has(isbn)){sendResponse({ok:true,queued:true});return;}
  const port=chrome.runtime.connect({name:"prezzolibri-collection"});
  ports.set(isbn,port);
  port.onMessage.addListener(data=>{
    window.postMessage({source:"prezzolibri-extension",isbn,...data},location.origin);
    if(data.type==="COMPLETE"||data.type==="ERROR"){ports.delete(isbn);port.disconnect();}
  });
  port.onDisconnect.addListener(()=>{ports.delete(isbn);if(chrome.runtime.lastError)window.postMessage({source:"prezzolibri-extension",type:"ERROR",isbn,error:chrome.runtime.lastError.message},location.origin);});
  port.postMessage({type:"START",book:{isbn,title,authors}});
  sendResponse({ok:true});
}
chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(message.type!=="PREZZOLIBRI_START")return;
  startCollection(sendResponse);
});
window.addEventListener("message",event=>{
  const message=event.data;
  if(event.source!==window||event.origin!==location.origin||message?.source!=="prezzolibri-app"||!["START_EXTENSION","QUEUE_EXTENSION_BOOK"].includes(message.type))return;
  startCollection(response=>window.postMessage({source:"prezzolibri-extension",type:"ACCEPTED",requestId:message.requestId,...response},location.origin),message.book);
});
