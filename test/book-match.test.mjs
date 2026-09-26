import test from "node:test";
import assert from "node:assert/strict";
import { relevantToBook } from "../public/book-match.js";

const book = { title:"Storia del Terzo Reich", authors:"William L. Shirer" };

test("riconosce il titolo quasi esatto anche senza autore", () => {
  assert.equal(relevantToBook({ title:"Storia del Terzo Reich - volume secondo" }, book), true);
});

test("riconosce titolo parziale quando compare l'autore", () => {
  assert.equal(relevantToBook({ title:"Terzo Reich di William Shirer" }, book), true);
});

test("scarta i suggerimenti generici restituiti da Vinted", () => {
  for (const title of ["Libro Robin Hood", "I Fioretti di San Francesco Città Nuova", "Il potere della mente"])
    assert.equal(relevantToBook({ title }, book), false);
});
