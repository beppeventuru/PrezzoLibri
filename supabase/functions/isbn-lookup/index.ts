import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const clean=(value:string)=>String(value||"").replace(/[^0-9X]/gi,"");
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  try{
    const {isbn:raw}=await req.json();const isbn=clean(raw);if(!/^(?:97[89]\d{10}|\d{9}[\dX])$/i.test(isbn))throw new Error("ISBN non valido");
    const google=await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`);
    if(google.ok){const item=(await google.json()).items?.[0];if(item){const v=item.volumeInfo||{};return Response.json({isbn,title:v.title||"",authors:(v.authors||[]).join(", "),publisher:v.publisher||"",year:String(v.publishedDate||"").slice(0,4),coverUrl:v.imageLinks?.thumbnail?.replace("http:","https:")||"",coverPrice:item.saleInfo?.listPrice?.currencyCode==="EUR"?item.saleInfo.listPrice.amount:null,source:"Google Books"},{headers:cors});}}
    const open=await fetch(`https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&limit=1`,{headers:{"User-Agent":"PrezzoLibri/1.0"}});const item=(await open.json()).docs?.[0];if(!item)throw new Error("Libro non trovato nei cataloghi");
    return Response.json({isbn,title:item.title||"",authors:(item.author_name||[]).join(", "),publisher:item.publisher?.[0]||"",year:String(item.first_publish_year||""),coverUrl:item.cover_i?`https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg`:"",coverPrice:null,source:"Open Library"},{headers:cors});
  }catch(error){return Response.json({error:error.message||"Errore ricerca ISBN"},{status:400,headers:cors});}
});
