import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
function outputText(data:any){return (data.output||[]).flatMap((x:any)=>x.content||[]).filter((x:any)=>x.type==="output_text").map((x:any)=>x.text).join("\n").trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"");}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  try{
    const key=Deno.env.get("OPENAI_API_KEY");if(!key)throw new Error("Chiave OpenAI non configurata nel backend");
    const {book}=await req.json();if(!book?.isbn)throw new Error("Libro non valido");
    const prompt=`Cerca offerte verificabili in Italia per ISBN ${book.isbn}, titolo ${book.title}, autore ${book.authors}. Cerca separatamente Vinted.it, eBay.it, AbeBooks.it, Subito.it e Amazon.it. Non inventare. Rispondi solo JSON: {"results":[{"platform":"vinted|ebay|abebooks|subito|amazon","status":"found|not_found|blocked","note":"","listings":[{"title":"","price":9.9,"shipping":0,"currency":"EUR","url":"https://...","relevance":"exact|high|medium|low","condition":"","evidenceType":"active|sold"}]}]}. Massimo 5 offerte per sito.`;
    const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:Deno.env.get("OPENAI_MODEL")||"gpt-5.4-mini",tools:[{type:"web_search"}],input:prompt})});
    const data=await response.json();if(!response.ok)throw new Error(data.error?.message||`OpenAI ${response.status}`);const parsed=JSON.parse(outputText(data));
    const platforms=["vinted","ebay","abebooks","subito","amazon"];const map=new Map((parsed.results||[]).map((x:any)=>[String(x.platform).toLowerCase(),x]));
    const results=platforms.map(platform=>{const result:any=map.get(platform)||{status:"not_found",note:"Nessun risultato",listings:[]};const listings=(result.listings||[]).filter((x:any)=>Number(x.price)>0&&x.currency==="EUR"&&/^https?:\/\//.test(x.url||"")).slice(0,5).map((x:any)=>({platform,title:String(x.title||""),price:Number(x.price),shipping:Math.max(0,Number(x.shipping)||0),url:String(x.url),relevance:["exact","high","medium","low"].includes(x.relevance)?x.relevance:"medium",condition:String(x.condition||""),evidenceType:x.evidenceType==="sold"?"sold":"active"}));return{platform,status:listings.length?"found":result.status,note:String(result.note||""),listings};});
    return Response.json({results},{headers:cors});
  }catch(error){return Response.json({error:error.message||"Errore ricerca marketplace"},{status:400,headers:cors});}
});
