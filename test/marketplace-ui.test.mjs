import test from "node:test";
import assert from "node:assert/strict";
import { savedMarketplaceResults } from "../public/marketplace-ui.js";

test("raggruppa i confronti salvati e conserva il nuovo Vinted come informativo", () => {
  const results = savedMarketplaceResults([
    { platform:"vinted", title:"Copia usata", price:"8", shipping:"1", condition:"Ottime", evidence_type:"active", date_label:"Caricato ieri" },
    { platform:"vinted", title:"Copia nuova", price:"15", condition:"Nuovo" },
    { platform:"ebay", title:"Copia venduta", price:"7", condition:"Usato", evidence_type:"sold" }
  ]);

  const vinted = results.find(result => result.platform === "vinted");
  const ebay = results.find(result => result.platform === "ebay");
  const amazon = results.find(result => result.platform === "amazon");

  assert.equal(vinted.status, "found");
  assert.equal(vinted.listings.length, 2);
  assert.equal(vinted.listings[0].price, 8);
  assert.equal(vinted.listings[0].shipping, 1);
  assert.equal(vinted.listings[1].accepted, false);
  assert.equal(ebay.listings[0].evidenceType, "sold");
  assert.equal(amazon.status, "not_found");
});

test("mantiene il nuovo Vinted in fondo come risultato escluso dal calcolo",()=>{
  const [vinted]=savedMarketplaceResults([
    {platform:"vinted",title:"Nuovo",price:15,condition:"Nuovo senza cartellino",accepted:false},
    {platform:"vinted",title:"Usato",price:10,condition:"Ottime",accepted:true}
  ]);
  assert.deepEqual(vinted.listings.map(item=>item.title),["Usato","Nuovo"]);
  assert.equal(vinted.listings[1].accepted,false);
});
