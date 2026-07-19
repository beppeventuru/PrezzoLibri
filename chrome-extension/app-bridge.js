let port;
function startCollection(sendResponse=()=>{}){
  const isbn=document.querySelector("#bookIsbn")?.value;
  const title=document.querySelector("#title")?.value;
  const authors=document.querySelector("#authors")?.value||"";
  if(!isbn||!title){sendResponse({ok:false,error:"Apri e salva prima il libro da valutare."});return;}
  port?.disconnect();port=chrome.runtime.connect({name:"prezzolibri-collection"});
  port.onMessage.addListener(data=>window.postMessage({source:"prezzolibri-extension",...data},location.origin));
  port.onDisconnect.addListener(()=>{if(chrome.runtime.lastError)window.postMessage({source:"prezzolibri-extension",type:"ERROR",error:chrome.runtime.lastError.message},location.origin);});
  port.postMessage({type:"START",book:{isbn,title,authors}});
  sendResponse({ok:true});
}
chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(message.type!=="PREZZOLIBRI_START")return;
  startCollection(sendResponse);
});
window.addEventListener("message",event=>{
  const message=event.data;
  if(event.source!==window||event.origin!==location.origin||message?.source!=="prezzolibri-app"||message.type!=="START_EXTENSION")return;
  startCollection(response=>window.postMessage({source:"prezzolibri-extension",type:"ACCEPTED",requestId:message.requestId,...response},location.origin));
});
