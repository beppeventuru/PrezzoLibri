const ALLOWED_HOSTS = {
  vinted:["www.vinted.it", "vinted.it"], ebay:["www.ebay.it", "ebay.it"], abebooks:["www.abebooks.it", "abebooks.it"],
  subito:["www.subito.it", "subito.it"], libraccio:["www.libraccio.it", "libraccio.it"], ibs:["www.ibs.it", "ibs.it"], amazon:["www.amazon.it", "amazon.it"]
};
export const normalizedComparableText = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it").replace(/\s+/g, " ").trim();
export function comparableKey(item) {
  if (item.platform !== "amazon") return `${item.platform}|${item.url}`;
  return ["amazon", item.evidenceType || item.evidence_type || "active", normalizedComparableText(item.title), normalizedComparableText(item.condition), Number(item.price).toFixed(2), Number(item.shipping || 0).toFixed(2)].join("|");
}
export function marketplaceCandidates(results, bookId) {
  const keys = new Set();
  return (results || []).flatMap(result => (result.listings || []).map(item => ({ ...item, platform:result.platform })))
    .filter(item => { try { return ALLOWED_HOSTS[item.platform]?.includes(new URL(item.url).hostname) && Number(item.price) > 0 && Number(item.price) < 100000; } catch { return false; } })
    .filter(item => item.platform === "vinted" || !/^\s*nuov/i.test(String(item.condition || "")))
    .filter(item => { const key = comparableKey(item); if (keys.has(key)) return false; keys.add(key); return true; })
    .map(item => ({ book_id:bookId, platform:item.platform, url:item.url, title:item.title || "", price:Number(item.price), shipping:Math.max(0, Number(item.shipping) || 0), condition:item.condition || "", relevance:["exact", "high", "medium", "low"].includes(item.relevance) ? item.relevance : "medium", evidence_type:item.evidenceType === "sold" ? "sold" : "active", date_label:item.dateLabel || "", accepted:!(item.platform === "vinted" && /^\s*nuov/i.test(String(item.condition || ""))) }));
}
