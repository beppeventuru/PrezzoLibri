import { $, escapeHtml, euro } from "./ui-utils.js";

const PLATFORM_NAMES = { vinted:"Vinted", ebay:"eBay", abebooks:"AbeBooks", subito:"Subito", libraccio:"Libraccio", ibs:"IBS", amazon:"Amazon" };

export function savedMarketplaceResults(comparables = []) {
  return Object.keys(PLATFORM_NAMES).map(platform => {
    const listings = comparables
      .filter(item => item.platform === platform && (platform === "vinted" || !/^\s*nuov/i.test(String(item.condition || ""))))
      .map(item => ({
        title:item.title,
        price:Number(item.price),
        shipping:Number(item.shipping || 0),
        url:item.url,
        condition:item.condition,
        relevance:item.relevance,
        evidenceType:item.evidence_type || "active",
        dateLabel:item.date_label || "",
        accepted:item.accepted !== false && !(platform === "vinted" && /^\s*nuov/i.test(String(item.condition || "")))
      })).sort((a,b)=>Number(a.accepted===false)-Number(b.accepted===false));
    return { platform, status:listings.length ? "found" : "not_found", note:"Risultati usati salvati per questo libro.", listings };
  });
}

export function renderWorkspace(book, marketplaceResults) {
  const analysis = book.analysis;
  $("#recommended").textContent = euro(analysis.recommendedPrice);
  $("#quick").textContent = euro(analysis.quickPrice);
  $("#maximum").textContent = euro(analysis.maximumPrice);
  $("#confidence").textContent = `Affidabilità ${analysis.confidence === "high" ? "alta" : analysis.confidence === "medium" ? "media" : "bassa"} · mediana mercato ${euro(analysis.marketMedian)}`;
  $("#explanation").textContent = analysis.explanation;
  $("#marketLinks").innerHTML = Object.entries(PLATFORM_NAMES).map(([key, name]) => `<article><h3>${name}</h3><a href="${book.links[key]}" target="_blank" rel="noopener">In vendita · ISBN ↗</a>${book.links.titleFallback?.[key] ? `<a class="fallback" href="${book.links.titleFallback[key]}" target="_blank" rel="noopener">In vendita · titolo ↗</a>` : ""}${book.links.sold?.[key] ? `<a class="sold-link" href="${book.links.sold[key]}" target="_blank" rel="noopener">Venduti ultimi 90 giorni ↗</a><small class="sold-note">eBay non mostra qui le vendite più vecchie.</small>` : ""}</article>`).join("");
  if (!marketplaceResults) $("#marketResults").innerHTML = `<p class="empty">Premi “Cerca i prezzi”: i risultati appariranno direttamente qui.</p>`;
}

export function renderMarketplaceResults(input) {
  const informational = item => item.accepted === false || (item.platform === "vinted" && /^\s*nuov/i.test(String(item.condition || "")));
  const results = input.map(result => ({ ...result, listings:(result.listings || [])
    .filter(item => result.platform === "vinted" || !/^\s*nuov/i.test(String(item.condition || "")))
    .map(item => ({ ...item, platform:result.platform, informational:informational({ ...item, platform:result.platform }) }))
    .sort((a,b)=>Number(a.informational)-Number(b.informational)) }));
  const listingRows = listings => listings.map(item => `<div class="listing${item.informational ? " informational-listing" : ""}"><div><b>${escapeHtml(item.title || "Offerta")}</b><small>${item.relevance === "exact" ? "ISBN esatto" : item.relevance === "high" ? "Stessa edizione probabile" : "Da verificare"}${item.condition ? ` · ${escapeHtml(item.condition)}` : ""}${item.informational ? ` · <span class="informational-label">Solo informativo, escluso dal calcolo</span>` : ""}</small></div><span class="listing-price"><strong>${euro(item.price + item.shipping)}</strong>${item.dateLabel ? `<small>${escapeHtml(item.dateLabel)}</small>` : ""}</span><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Verifica ↗</a></div>`).join("");
  const sections = results.flatMap(result => result.platform !== "ebay" ? [{ ...result, label:PLATFORM_NAMES[result.platform] || result.platform }] : [
    { ...result, label:"eBay in vendita", listings:result.listings.filter(item => item.evidenceType !== "sold"), emptyNote:"Nessun annuncio attivo pertinente." },
    { ...result, label:"eBay venduti", listings:result.listings.filter(item => item.evidenceType === "sold"), emptyNote:"Nessuna vendita conclusa trovata.", soldSection:true }
  ]);
  $("#marketResults").innerHTML = sections.map(result => `<details class="market-result${result.soldSection ? " sold-market-result" : ""}"><summary class="market-result-head"><h3>${escapeHtml(result.label)}</h3><span class="${result.listings.length ? "found" : escapeHtml(result.status)}">${result.listings.length ? `${result.listings.length} ${result.listings.length === 1 ? "risultato" : "risultati"}` : result.status === "blocked" ? "Non accessibile" : "Nessun risultato"}</span></summary><div class="market-result-body">${result.soldSection ? `<p class="sold-explanation">Vendite concluse: sono il riferimento più importante per stimare il prezzo reale.</p>` : ""}${result.listings.length ? listingRows(result.listings) : `<p class="empty">${escapeHtml(result.emptyNote || result.note || "Nessuna offerta verificabile trovata.")}</p>`}</div></details>`).join("");
}
