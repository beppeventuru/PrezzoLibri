(() => {
  const { text, money, listing, parsers } = globalThis.PrezzoLibriScrapers;
  parsers.libraccio = ({ isbn }) => {
    const detail = document.querySelector(".detail");
    const detailText = text(detail);
    const title = text(detail?.querySelector("h1")) || document.title;
    if (!detail || !detailText.includes(isbn)) return [];
    const author = text(detail.querySelector('a[href*="/autore/"]'));
    const usedBox = detail.querySelector(".buybox-used") || [...detail.querySelectorAll(".subbuybox")].find(node => node.querySelector(".acquista-usato"));
    if (!usedBox) return [];
    const buyUsed = usedBox.querySelector(".acquista-usato");
    const tracking = buyUsed?.getAttribute("data-tracking-info") || "";
    const visiblePrice = money(text(usedBox.querySelector(".currentprice")));
    const trackedPrice = money(tracking.match(/productused_price['"]?\s*:\s*['"]([0-9.]+)/i)?.[1]);
    const price = visiblePrice || trackedPrice;
    return price ? [listing("libraccio", `${title}${author ? ` — ${author}` : ""}`, price, location.href, "Usato selezionato da Libraccio", 0, "active", "exact")] : [];
  };
})();
