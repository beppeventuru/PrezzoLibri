(() => {
  const { text, money, listing, waitFor, parsers } = globalThis.PrezzoLibriScrapers;
  parsers.ibs = async ({ isbn }) => {
    await waitFor(`a[href*="/e/${isbn}"]`, 8000);
    const title = text(document.querySelector("h1")) || text(document.querySelector(`a.cc-title[href*="/e/${isbn}"]`)) || document.title;
    const seen = new Set();
    const offers = [];
    for (const row of document.querySelectorAll(".cc-seller-row")) {
      const rowText = text(row);
      if (!/\bLIBRO USATO\b/i.test(rowText) && !row.querySelector(".cc-item-label--usato")) continue;
      const link = row.querySelector(`a[href*="/e/${isbn}"][href*="inventoryId="]`);
      const inventoryId = link?.href.match(/[?&]inventoryId=(\d+)/i)?.[1];
      if (!link || !inventoryId || seen.has(inventoryId)) continue;
      const shipping = money(rowText.match(/Spedizione\s+([0-9.]+,[0-9]{2})\s*€/i)?.[1]);
      const priceValues = [...rowText.matchAll(/([0-9.]+,[0-9]{2})\s*€/g)].map(match => money(match[1]));
      const price = priceValues.at(-1);
      const condition = text(row.querySelector(".cc-item-label--usato + .cc-item-label")) || "Usato";
      const seller = rowText.match(/(?:Venduto e spedito da|Usato di Libraccio venduto da)\s+(.+?)(?=\s+(?:Spedizione|[0-9]+\/|Disponibil|-\d+%|[0-9.,]+\s*€))/i)?.[1] || "IBS";
      if (!price) continue;
      seen.add(inventoryId);
      offers.push(listing("ibs", `${title} — ${seller}`, price, link.href, condition, shipping, "active", "exact"));
    }
    if (offers.length) return offers.slice(0, 50);
    const usedVariant = [...document.querySelectorAll(`a.cc-item[data-condizione="usato"][href*="/e/${isbn}"]`)].find(link => /LIBRO USATO/i.test(text(link)));
    const price = money(text(usedVariant?.querySelector(".cc-item-price")));
    return price ? [listing("ibs", title, price, usedVariant.href, "Usato", 0, "active", "exact")] : [];
  };
})();
