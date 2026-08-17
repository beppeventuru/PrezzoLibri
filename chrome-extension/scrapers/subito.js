(() => {
  const { text, money, absolute, listing, parsers } = globalThis.PrezzoLibriScrapers;
  parsers.subito = () => {
    const seen = new Set();
    return [...document.querySelectorAll('a[href*=".htm"]')].flatMap(link => {
      const root = link.closest("article") || link.parentElement?.parentElement;
      const match = text(root).match(/(?:€\s*)?(\d+(?:[.,]\d{2})?)\s*€/);
      const price = money(match?.[1]);
      const url = absolute(link.href);
      if (!price || !url || seen.has(url)) return [];
      seen.add(url);
      return [listing("subito", text(root?.querySelector("h2,h3")) || link.getAttribute("title") || "Annuncio Subito", price, url)];
    }).slice(0, 50);
  };
})();
