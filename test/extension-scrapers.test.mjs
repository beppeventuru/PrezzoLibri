import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const scraperFiles = ["common", "vinted", "ebay", "abebooks", "subito", "libraccio", "ibs", "amazon"];

test("carica un parser separato per ogni marketplace", async () => {
  const context = vm.createContext({
    globalThis:null,
    URL,
    location:{ origin:"https://example.test" },
    document:{ querySelector:() => null }
  });
  context.globalThis = context;

  for (const name of scraperFiles) {
    const source = await readFile(new URL(`../chrome-extension/scrapers/${name}.js`, import.meta.url), "utf8");
    vm.runInContext(source, context, { filename:`${name}.js` });
  }

  assert.deepEqual(
    Object.keys(context.PrezzoLibriScrapers.parsers).sort(),
    ["abebooks", "amazonOffers", "amazonSearch", "ebay", "ibs", "libraccio", "subito", "vinted"]
  );
});
