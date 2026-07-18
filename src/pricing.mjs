const RELEVANCE = { exact: 1, high: 0.85, medium: 0.55, low: 0.25 };
const EVIDENCE = { sold: 1.35, active: 0.75 };
const MARKET = { vinted: 1, ebay: 0.9, abebooks: 0.78, subito: 0.95, amazon: 0.82, other: 0.7 };

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function weightedMedian(items) {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, item) => sum + item.weight, 0);
  let current = 0;
  for (const item of sorted) {
    current += item.weight;
    if (current >= total / 2) return item.value;
  }
  return sorted.at(-1).value;
}

const money = value => Math.max(1, Math.round(value));

export function calculatePrice({ comparables = [], coverPrice = null, condition = "good" }) {
  const accepted = comparables.filter(item => item.accepted !== false && Number(item.price) > 0);
  const normalized = accepted.map(item => {
    const total = Number(item.price) + Number(item.shipping || 0);
    const provider = String(item.platform || "other").toLowerCase();
    return {
      value: total * (MARKET[provider] ?? MARKET.other),
      weight: (RELEVANCE[item.relevance] ?? RELEVANCE.medium) *
        (EVIDENCE[item.evidenceType] ?? EVIDENCE.active)
    };
  });
  const market = weightedMedian(normalized);
  const conditionFactor = { new: 0.72, excellent: 0.62, good: 0.5, fair: 0.35, poor: 0.2 }[condition] ?? 0.5;
  const local = Number(coverPrice) > 0 ? Number(coverPrice) * conditionFactor : null;
  let recommended;
  if (market != null && local != null) recommended = market * 0.7 + local * 0.3;
  else recommended = market ?? local ?? 5;
  const confidencePoints = Math.min(60, accepted.length * 10) +
    Math.min(25, accepted.filter(x => x.relevance === "exact").length * 8) +
    Math.min(15, accepted.filter(x => x.evidenceType === "sold").length * 15);
  return {
    quickPrice: money(recommended * 0.82),
    recommendedPrice: money(recommended),
    maximumPrice: money(recommended * 1.28),
    confidence: confidencePoints >= 75 ? "high" : confidencePoints >= 40 ? "medium" : "low",
    comparableCount: accepted.length,
    soldCount: accepted.filter(x => x.evidenceType === "sold").length,
    marketMedian: market == null ? null : money(market),
    explanation: accepted.length
      ? `Stima basata su ${accepted.length} confronti, di cui ${accepted.filter(x => x.evidenceType === "sold").length} vendite concluse.`
      : "Stima provvisoria basata soltanto su prezzo di copertina e condizioni."
  };
}
