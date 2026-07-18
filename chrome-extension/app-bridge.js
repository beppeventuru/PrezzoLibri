let port;
chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
  if(message.type!=="PREZZOLIBRI_START")return;
  const isbn=document.querySelector("#bookIsbn")?.value;
  const title=document.querySelector("#title")?.value;
  const authors=document.querySelector("#authors")?.value||"";
  if(!isbn||!title){sendResponse({ok:false,error:"Apri e salva prima il libro da valutare."});return;}
  port?.disconnect();port=chrome.runtime.connect({name:"prezzolibri-collection"});
  port.onMessage.addListener(data=>window.postMessage({source:"prezzolibri-extension",...data},location.origin));
  port.postMessage({type:"START",book:{isbn,title,authors}});
  sendResponse({ok:true});
});
