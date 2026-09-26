(() => {
  const ignored = new Set(["della", "delle", "degli", "come", "libro", "edizione", "sono", "alla", "nelle"]);
  const normalized = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it");
  const tokens = value => [...new Set(normalized(value).match(/[a-z0-9]{3,}/g) || [])].filter(token => !ignored.has(token));
  globalThis.PrezzoLibriRelevantToBook = (item, book) => {
    const listingTokens = new Set(tokens(item?.title));
    const titleTokens = tokens(book?.title);
    const authorTokens = tokens(book?.authors);
    const titleMatches = titleTokens.filter(token => listingTokens.has(token)).length;
    const authorMatches = authorTokens.filter(token => listingTokens.has(token)).length;
    if (!titleTokens.length) return false;
    if (titleTokens.length === 1) return titleMatches === 1 && (!authorTokens.length || authorMatches >= 1);
    return titleMatches / titleTokens.length >= .8 || (titleMatches >= 2 && authorMatches >= 1);
  };
})();
