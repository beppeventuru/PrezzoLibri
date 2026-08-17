(() => {
  const { text, money, listing, fetchDocument, mapLimited, parsers } = globalThis.PrezzoLibriScrapers;
  parsers.vinted = async () => {
    const items = [...document.querySelectorAll('[data-testid$="--overlay-link"]')].flatMap(link => {
      const id = link.dataset.testid?.match(/product-item-id-(\d+)/)?.[1];
      const root = link.closest('[data-testid^="product-item-id-"]') || link.parentElement;
      const price = money(text(document.querySelector(`[data-testid="product-item-id-${id}--price-text"]`)));
      const image = root?.querySelector("img");
      const title = link.getAttribute("title") || image?.alt || "Annuncio Vinted";
      return price ? [{ ...listing("vinted", title.replace(/, condizioni:.*$/i, ""), price, link.href, title.match(/condizioni:\s*([^,]+)/i)?.[1] || "Usato"), coverUrl:image?.currentSrc || image?.src || "" }] : [];
    });
    return mapLimited(items, 4, async item => {
      const doc = await fetchDocument(item.url);
      const uploaded = text(doc?.querySelector('[itemprop="upload_date"]'));
      return uploaded ? { ...item, dateLabel:`Caricato ${uploaded}` } : item;
    });
  };
})();
