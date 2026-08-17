(() => {
  const { text, money, listing, fetchDocument, mapLimited, parsers } = globalThis.PrezzoLibriScrapers;
  const startLabel = doc => {
    for (const script of doc?.querySelectorAll('script[type="application/ld+json"]') || []) {
      try {
        const starts = JSON.parse(script.textContent)?.offers?.availabilityStarts;
        if (starts) {
          const date = new Date(starts);
          if (!Number.isNaN(date.valueOf())) return `In vendita dal ${new Intl.DateTimeFormat("it-IT", { day:"numeric", month:"short", year:"numeric" }).format(date)}`;
        }
      } catch {}
    }
    const match = doc?.documentElement?.innerHTML.match(/"startDate":\{"value":"([^"]+)"/);
    if (!match) return "";
    const date = new Date(match[1]);
    return Number.isNaN(date.valueOf()) ? "" : `In vendita dal ${new Intl.DateTimeFormat("it-IT", { day:"numeric", month:"short", year:"numeric" }).format(date)}`;
  };
  parsers.ebay = async ({ sold, title:expectedTitle }) => {
    const key = String(expectedTitle || "").toLocaleLowerCase("it").match(/[a-zà-ÿ0-9]{5,}/g)?.sort((a, b) => b.length - a.length)[0] || "";
    const seen = new Set();
    const items = [...document.querySelectorAll(".s-item, .s-card")].flatMap(root => {
      const title = text(root.querySelector(".s-item__title, .s-card__title"));
      const price = money(text(root.querySelector(".s-item__price, .s-card__price")));
      const rawLink = root.querySelector("a.s-item__link, a.s-card__link, a[href*='/itm/']")?.href;
      const rootText = text(root);
      const itemId = rawLink?.match(/\/itm\/(?:[^/?]+\/)?(\d{9,15})/i)?.[1];
      if (!price || !rawLink || !itemId || seen.has(itemId) || !key || !title.toLocaleLowerCase("it").includes(key) || /Shop on eBay|Esplora eBay/i.test(title) || /REC\.SEED|pg=2334524/i.test(rawLink)) return [];
      if (sold && !/vendut[oi]\b/i.test(rootText)) return [];
      seen.add(itemId);
      const soldDate = rootText.match(/Vendut[oi]\s+(.+?\b\d{4})/i)?.[1] || "";
      return [listing("ebay", title, price, `https://www.ebay.it/itm/${itemId}`, text(root.querySelector(".SECONDARY_INFO, .s-card__subtitle")) || "Usato", 0, sold ? "sold" : "active", "high", soldDate ? `Venduto ${soldDate}` : "")];
    }).slice(0, 50);
    if (sold) return items;
    return mapLimited(items, 6, async item => {
      const dateLabel = startLabel(await fetchDocument(item.url));
      return dateLabel ? { ...item, dateLabel } : item;
    });
  };
})();
