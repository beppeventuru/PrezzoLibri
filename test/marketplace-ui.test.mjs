import test from "node:test";
import assert from "node:assert/strict";
import { savedMarketplaceResults } from "../public/marketplace-ui.js";

test("raggruppa i confronti salvati per marketplace ed esclude il nuovo", () => {
  const results = savedMarketplaceResults([
    { platform:"vinted", title:"Copia usata", price:"8", shipping:"1", condition:"Ottime", evidence_type:"active", date_label:"Caricato ieri" },
    { platform:"vinted", title:"Copia nuova", price:"15", condition:"Nuovo" },
    { platform:"ebay", title:"Copia venduta", price:"7", condition:"Usato", evidence_type:"sold" }
  ]);

  const vinted = results.find(result => result.platform === "vinted");
  const ebay = results.find(result => result.platform === "ebay");
  const amazon = results.find(result => result.platform === "amazon");

  assert.equal(vinted.status, "found");
  assert.equal(vinted.listings.length, 1);
  assert.equal(vinted.listings[0].price, 8);
  assert.equal(vinted.listings[0].shipping, 1);
  assert.equal(ebay.listings[0].evidenceType, "sold");
  assert.equal(amazon.status, "not_found");
});
