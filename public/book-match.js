const IGNORED_BOOK_WORDS = new Set(["della", "delle", "degli", "come", "libro", "edizione", "sono", "alla", "nelle"]);

export const normalizedBookText = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it");
const tokens = value => [...new Set(normalizedBookText(value).match(/[a-z0-9]{3,}/g) || [])].filter(token => !IGNORED_BOOK_WORDS.has(token));

export function relevantToBook(item, book) {
  const listingTokens = new Set(tokens(item?.title));
  const titleTokens = tokens(book?.title);
  const authorTokens = tokens(book?.authors);
  const titleMatches = titleTokens.filter(token => listingTokens.has(token)).length;
  const authorMatches = authorTokens.filter(token => listingTokens.has(token)).length;
  if (!titleTokens.length) return false;
  if (titleTokens.length === 1) return titleMatches === 1 && (!authorTokens.length || authorMatches >= 1);
  return titleMatches / titleTokens.length >= 0.8 || (titleMatches >= 2 && authorMatches >= 1);
}
