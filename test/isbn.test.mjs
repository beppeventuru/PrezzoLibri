import test from "node:test";
import assert from "node:assert/strict";
import { canonicalIsbn, cleanIsbn, isValidIsbn, isbn10To13 } from "../src/isbn.mjs";

test("pulisce e valida ISBN dalla foto", () => {
  assert.equal(cleanIsbn("88-04-49986-9"), "8804499869");
  assert.equal(isValidIsbn("88-04-49986-9"), true);
  assert.equal(isValidIsbn("9788804499862"), true);
});

test("converte ISBN-10 in ISBN-13 canonico", () => {
  assert.equal(isbn10To13("8804499869"), "9788804499862");
  assert.equal(canonicalIsbn("88-04-49986-9"), "9788804499862");
});

test("rifiuta codici con check digit errata", () => {
  assert.equal(isValidIsbn("9788804499863"), false);
  assert.equal(canonicalIsbn("123"), null);
});
