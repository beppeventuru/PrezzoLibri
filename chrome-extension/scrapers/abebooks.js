(() => {
  const { text, money, absolute, listing, waitFor, parsers } = globalThis.PrezzoLibriScrapers;
  parsers.abebooks = async ({ title:expectedTitle }) => {
    await waitFor('a[href*="/bd"], [data-test-id="listing-title-link"], script[type="application/ld+json"]');
    const links = [...document.querySelectorAll('[data-test-id="listing-title-link"]')];
    const direct = links.flatMap((link, index) => {
      const priceNode = document.querySelector(`[data-test-id="item-price-${index}"]`) || document.querySelectorAll('[data-test-id^="item-price-"]')[index];
      const price = money(text(priceNode));
      const shipping = money(text(document.querySelector(`[data-test-id="item-shipping-price-${index}"]`)));
      const condition = text(document.querySelector(`[data-test-id="listing-book-condition-${index}"]`)).replace(/^Condizione:\s*/i, "");
      return price ? [listing("abebooks", expectedTitle || text(link.querySelector("h2")) || text(link), price, link.href, condition || "Usato", shipping, "active", "exact")] : [];
    }).slice(0, 50);
    if (direct.length) return direct;

    const generic = [];
    const seen = new Set();
    for (const link of document.querySelectorAll('a[href*="/bd"]')) {
      const url = absolute(link.href);
      if (!/\/\d+\/bd(?:[?#]|$)/i.test(url) || seen.has(url)) continue;
      let card = link;
      for (let level = 0; level < 10 && card?.parentElement; level++) {
        card = card.parentElement;
        const cardText = text(card);
        if (/EUR\s*[0-9]+[,.][0-9]{2}/i.test(cardText) && cardText.length < 6000) break;
      }
      const cardText = text(card);
      const priceMatch = cardText.match(/EUR\s*([0-9]+[,.][0-9]{2})/i);
      if (!priceMatch) continue;
      const shippingMatch = cardText.match(/(?:Spedizione\s*)?EUR\s*([0-9]+[,.][0-9]{2})\s*spedizione/i) || cardText.match(/Spedizione\s*EUR\s*([0-9]+[,.][0-9]{2})/i);
      const condition = cardText.match(/Condizione:\s*([^|\n]+?)(?=\s+(?:EUR|Spedizione|Da:|Quantità)|$)/i)?.[1] || "Usato";
      seen.add(url);
      generic.push(listing("abebooks", expectedTitle || "Offerta AbeBooks", money(priceMatch[1]), url, condition, shippingMatch ? money(shippingMatch[1]) : 0, "active", "exact"));
    }
    if (generic.length) return generic.slice(0, 50);

    const fallback = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent);
        for (const entry of data.itemListElement || data.mainEntity?.itemListElement || []) {
          const book = entry.item;
          const offer = book?.offers;
          if (offer?.price && offer?.url) fallback.push(listing("abebooks", expectedTitle || book.name || "Offerta AbeBooks", Number(offer.price), offer.url, "Usato", 0, "active", offer.gtin13 ? "exact" : "high"));
        }
      } catch {}
    }
    return fallback.slice(0, 50);
  };
})();
