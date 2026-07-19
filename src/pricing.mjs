export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, position) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * position;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower + 1] == null
    ? sorted[lower]
    : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

// I prezzi si distribuiscono in modo moltiplicativo: il filtro IQR lavora sui
// logaritmi, così un annuncio da 50 € non deforma un gruppo concentrato a 8-10 €.
function robustPrices(items) {
  const prices = items.map(item => Number(item.price)).filter(price => price > 0);
  if (prices.length < 4) return prices;
  const logs = prices.map(Math.log);
  const q1 = percentile(logs, 0.25);
  const q3 = percentile(logs, 0.75);
  const spread = q3 - q1;
  const lower = q1 - 1.5 * spread;
  const upper = q3 + 1.5 * spread;
  const filtered = prices.filter(price => Math.log(price) >= lower && Math.log(price) <= upper);
  return filtered.length ? filtered : prices;
}

const center = items => median(robustPrices(items));
const upperPrice = items => percentile(robustPrices(items), 0.75);
const money = value => Math.max(1, Math.round(value));
const evidence = item => item.evidenceType || item.evidence_type || "active";
const isReliable = item => item.relevance !== "low" && item.relevance !== "medium";

export function calculatePrice({ comparables = [], coverPrice = null, condition = "good" }) {
  const accepted = comparables.filter(item => item.accepted !== false && Number(item.price) > 0);
  const reliable = accepted.filter(isReliable);
  const usable = reliable.length ? reliable : accepted.filter(item => item.relevance !== "low");
  const providers = [...new Set(accepted.map(item => String(item.platform || "other").toLowerCase()))];
  const group = (platform, type = "active") => usable.filter(item =>
    String(item.platform || "other").toLowerCase() === platform && evidence(item) === type);
  const usedPreferred = platform => {
    const all = group(platform);
    const used = all.filter(item => /usato|buon|ottim|accettabil|seconda mano/i.test(String(item.condition || "")));
    return used.length ? used : all;
  };

  const sold = usable.filter(item => evidence(item) === "sold");
  const vinted = group("vinted");
  const ebayActive = group("ebay");
  const subito = group("subito");
  const libraccio = usedPreferred("libraccio");
  const ibs = usedPreferred("ibs");
  const amazon = usedPreferred("amazon");
  const abebooks = usedPreferred("abebooks");
  const soldCenter = center(sold);
  const vintedCenter = center(vinted);
  const ebayCenter = center(ebayActive);
  const subitoCenter = center(subito);
  const libraccioCenter = center(libraccio);
  const ibsCenter = center(ibs);
  const amazonCenter = center(amazon);
  const abeCenter = center(abebooks);

  let market = null;
  let basis = "prezzo di copertina e condizioni";

  if (soldCenter != null && vintedCenter != null) {
    // Vinted è il mercato su cui verrà pubblicato il libro. Se diverge molto
    // dalle vendite eBay, non mischiamo i due mercati: seguiamo Vinted.
    if (vintedCenter < soldCenter / 2) {
      market = vintedCenter;
      basis = "annunci Vinted (mercato distinto dalle vendite eBay)";
    } else if (vintedCenter > soldCenter * 2) {
      market = soldCenter;
      basis = "vendite concluse eBay (annunci Vinted anomali)";
    } else {
      const soldCeiling = sold.length >= 2 ? soldCenter * 1.05 : soldCenter * 1.2;
      market = Math.min(vintedCenter, soldCeiling);
      basis = "vendite concluse eBay, verificate sugli annunci Vinted";
    }
  } else if (soldCenter != null) {
    market = soldCenter;
    basis = "vendite concluse eBay";
  } else if (vintedCenter != null) {
    market = vintedCenter;
    basis = "annunci Vinted";
  } else if (libraccioCenter != null) {
    market = libraccioCenter * 0.9;
    basis = "prezzi usati Libraccio, adattati alla vendita tra privati su Vinted";
  } else if (ebayCenter != null) {
    market = ebayCenter * 0.9;
    basis = "annunci eBay, ridotti perché non ancora venduti";
  } else if (subitoCenter != null) {
    market = subitoCenter * 0.9;
    basis = "annunci Subito, ridotti perché non ancora venduti";
  } else {
    const secondary = [ibsCenter, amazonCenter, abeCenter].filter(value => value != null);
    if (secondary.length) {
      market = Math.min(...secondary) * 0.75;
      basis = "prezzo più prudente tra IBS, Amazon e AbeBooks";
    }
  }

  const sourceCenters = [soldCenter, vintedCenter, ebayCenter, subitoCenter, libraccioCenter, ibsCenter, amazonCenter, abeCenter]
    .filter(value => value != null && value > 0);
  const spreadRatio = sourceCenters.length >= 2 ? Math.max(...sourceCenters) / Math.min(...sourceCenters) : 1;
  const disagreement = spreadRatio > 2;
  const targetConditionFactor = { new: 1.12, excellent: 1.05, good: 1, fair: 0.8, poor: 0.55 }[condition] ?? 1;
  const coverConditionFactor = { new: 0.72, excellent: 0.62, good: 0.5, fair: 0.35, poor: 0.2 }[condition] ?? 0.5;
  const local = Number(coverPrice) > 0 ? Number(coverPrice) * coverConditionFactor : null;
  const unadjusted = market ?? local ?? 5;
  const recommended = market == null ? unadjusted : unadjusted * targetConditionFactor;

  const targetUpper = upperPrice(vinted) ?? upperPrice(sold) ?? upperPrice(libraccio) ?? upperPrice(ebayActive) ?? upperPrice(subito);
  const maximumBase = targetUpper == null ? recommended * 1.25 : Math.max(recommended, targetUpper * targetConditionFactor);
  const maximum = Math.min(maximumBase, recommended * (disagreement ? 1.25 : 1.5));
  let confidence = "low";
  if (!disagreement && sold.length >= 3 && vinted.length >= 1) confidence = "high";
  else if (!disagreement && (sold.length >= 1 || vinted.length >= 2)) confidence = "medium";

  const warning = disagreement
    ? ` I mercati sono molto discordanti (il più alto è ${spreadRatio.toFixed(1)} volte il più basso), quindi non sono stati mediati.`
    : "";
  return {
    quickPrice: money(recommended * 0.85),
    recommendedPrice: money(recommended),
    maximumPrice: money(maximum),
    confidence,
    comparableCount: accepted.length,
    marketplaceCount: providers.length,
    soldCount: accepted.filter(item => evidence(item) === "sold").length,
    marketMedian: market == null ? null : money(market),
    disagreement,
    spreadRatio,
    basis,
    explanation: accepted.length
      ? `Stima basata principalmente su ${basis}. Considerati ${accepted.length} confronti, di cui ${accepted.filter(item => evidence(item) === "sold").length} vendite concluse.${warning}`
      : "Stima provvisoria basata soltanto su prezzo di copertina e condizioni."
  };
}
