import test from "node:test";
import assert from "node:assert/strict";
import { calculatePrice, median } from "../src/pricing.mjs";

test("calcola la mediana senza farsi dominare dagli estremi", () => {
  assert.equal(median([10, 12, 350]), 12);
  assert.equal(median([10, 12, 14, 100]), 13);
});

test("una vendita conclusa esatta pesa più di annunci attivi", () => {
  const result = calculatePrice({ condition:"good", comparables:[
    { platform:"ebay", price:55, shipping:0, relevance:"exact", evidenceType:"sold" },
    { platform:"amazon", price:132.62, shipping:6, relevance:"exact", evidenceType:"active" },
    { platform:"vinted", price:350, shipping:0, relevance:"low", evidenceType:"active" }
  ]});
  assert.equal(result.soldCount, 1);
  assert.ok(result.recommendedPrice >= 45 && result.recommendedPrice <= 80);
  assert.notEqual(result.recommendedPrice, 350);
});

test("funziona senza API e senza confronti", () => {
  const result = calculatePrice({ coverPrice:20, condition:"good", comparables:[] });
  assert.equal(result.recommendedPrice, 10);
  assert.equal(result.confidence, "low");
});

test("ignora confronti esclusi", () => {
  const result = calculatePrice({ comparables:[
    { platform:"vinted", price:10, relevance:"exact", evidenceType:"active" },
    { platform:"vinted", price:1000, relevance:"exact", evidenceType:"sold", accepted:false }
  ]});
  assert.equal(result.comparableCount, 1);
  assert.equal(result.recommendedPrice, 10);
});

test("molte offerte Amazon non dominano gli altri marketplace", () => {
  const amazon = Array.from({length:30}, () => ({ platform:"amazon", price:30, relevance:"exact", evidenceType:"active" }));
  const result = calculatePrice({ comparables:[...amazon,
    { platform:"vinted", price:10, relevance:"exact", evidenceType:"active" },
    { platform:"subito", price:12, relevance:"exact", evidenceType:"active" },
    { platform:"ebay", price:11, relevance:"exact", evidenceType:"sold" }
  ]});
  assert.equal(result.marketplaceCount, 4);
  assert.ok(result.recommendedPrice <= 12);
});

test("la spedizione del compratore non aumenta il prezzo da pubblicare", () => {
  const withoutShipping = calculatePrice({ comparables:[
    { platform:"vinted", price:8, shipping:0, relevance:"exact", evidenceType:"active" }
  ]});
  const withShipping = calculatePrice({ comparables:[
    { platform:"vinted", price:8, shipping:40, relevance:"exact", evidenceType:"active" }
  ]});
  assert.equal(withShipping.recommendedPrice, withoutShipping.recommendedPrice);
});

test("Amazon e AbeBooks sproporzionati non alzano la stima Vinted", () => {
  const result = calculatePrice({ comparables:[
    { platform:"vinted", price:5, relevance:"exact", evidenceType:"active" },
    { platform:"vinted", price:7, relevance:"exact", evidenceType:"active" },
    { platform:"amazon", price:28, relevance:"exact", evidenceType:"active" },
    { platform:"abebooks", price:42, shipping:42, relevance:"exact", evidenceType:"active" }
  ]});
  assert.equal(result.recommendedPrice, 6);
  assert.equal(result.disagreement, true);
  assert.equal(result.confidence, "low");
});

test("se Vinted e le vendite concluse rappresentano mercati diversi non li media", () => {
  const result = calculatePrice({ comparables:[
    { platform:"vinted", price:3, relevance:"exact", evidenceType:"active" },
    { platform:"ebay", price:8, relevance:"exact", evidenceType:"sold" },
    { platform:"ebay", price:10, relevance:"exact", evidenceType:"sold" },
    { platform:"ebay", price:50, relevance:"exact", evidenceType:"sold" }
  ]});
  assert.equal(result.recommendedPrice, 3);
  assert.match(result.basis, /Vinted/);
});

test("senza Vinted usa le vendite concluse e resiste agli estremi", () => {
  const soldPrices = [8, 9, 9, 10, 10, 11, 50];
  const result = calculatePrice({ comparables:soldPrices.map(price =>
    ({ platform:"ebay", price, relevance:"exact", evidenceType:"sold" })) });
  assert.equal(result.recommendedPrice, 10);
});

test("su IBS privilegia le offerte usate rispetto a quelle nuove", () => {
  const newOffers = Array.from({length:10}, () =>
    ({ platform:"ibs", price:15, condition:"Nuovo", relevance:"exact", evidenceType:"active" }));
  const result = calculatePrice({ comparables:[...newOffers,
    { platform:"ibs", price:4, condition:"In buone condizioni", relevance:"exact", evidenceType:"active" },
    { platform:"ibs", price:8, condition:"Ottima condizione", relevance:"exact", evidenceType:"active" }
  ]});
  assert.equal(result.recommendedPrice, 5);
});
