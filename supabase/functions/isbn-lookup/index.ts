import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const clean=(value:string)=>String(value||"").replace(/[^0-9X]/gi,"");
const retryStatuses=[429,500,502,503,504];
const wait=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));
async function fetchWithRetry(url:string|URL,attempts=4){
  let last:Response|null=null;const delays=[700,1600,3200];
  for(let attempt=0;attempt<attempts;attempt++){
    try{const response=await fetch(url);last=response;if(!retryStatuses.includes(response.status))return response;}
    catch(error){if(attempt===attempts-1)throw error;}
    if(attempt<attempts-1)await wait(delays[attempt]||1000);
  }
  return last??fetch(url);
}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  try{
    const {isbn:raw}=await req.json();const isbn=clean(raw);if(!/^(?:97[89]\d{10}|\d{9}[\dX])$/i.test(isbn))throw new Error("ISBN non valido");
    const googleUrl=new URL("https://www.googleapis.com/books/v1/volumes");
    googleUrl.searchParams.set("q",`isbn:${isbn}`);googleUrl.searchParams.set("maxResults","1");googleUrl.searchParams.set("projection","full");
    const googleKey=Deno.env.get("GOOGLE_BOOKS_API_KEY");if(googleKey)googleUrl.searchParams.set("key",googleKey);
    const google=await fetchWithRetry(googleUrl);
    if(google.ok){const item=(await google.json()).items?.[0];if(item){const v=item.volumeInfo||{};const googleCover=item.id?`https://books.google.com/books/content?id=${encodeURIComponent(item.id)}&printsec=frontcover&img=1&zoom=1&source=gbs_api`:"";return Response.json({isbn,title:v.title||"",authors:(v.authors||[]).join(", "),publisher:v.publisher||"",year:String(v.publishedDate||"").slice(0,4),coverUrl:v.imageLinks?.thumbnail?.replace("http:","https:")||googleCover,coverPrice:item.saleInfo?.listPrice?.currencyCode==="EUR"?item.saleInfo.listPrice.amount:null,source:"Google Books"},{headers:cors});}}
    const open=await fetchWithRetry(`https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&limit=1`,3);const item=open.ok?(await open.json()).docs?.[0]:null;if(!item)throw new Error(`Libro non trovato nei cataloghi (Google Books ${google.status}, Open Library ${open.status})`);
    return Response.json({isbn,title:item.title||"",authors:(item.author_name||[]).join(", "),publisher:item.publisher?.[0]||"",year:String(item.first_publish_year||""),coverUrl:item.cover_i?`https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg`:"",coverPrice:null,source:"Open Library"},{headers:cors});
  }catch(error){return Response.json({error:error.message||"Errore ricerca ISBN"},{status:400,headers:cors});}
});
