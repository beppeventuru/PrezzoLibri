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

test("ogni parser conserva i selettori essenziali del proprio marketplace", async () => {
  const contracts = {
    vinted:["product-item-id-", "--price-text", "upload_date"],
    ebay:[".s-item, .s-card", "s-item__price", "Vendut"],
    libraccio:[".buybox-used", ".acquista-usato", ".currentprice"],
    ibs:[".cc-seller-row", "LIBRO USATO", "inventoryId="],
    amazon:["s-search-result", "#aod-offer", "condition=used"]
  };
  for (const [name, markers] of Object.entries(contracts)) {
    const source = await readFile(new URL(`../chrome-extension/scrapers/${name}.js`, import.meta.url), "utf8");
    for (const marker of markers) assert.ok(source.includes(marker), `${name} deve estrarre tramite ${marker}`);
  }
});
