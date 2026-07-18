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
