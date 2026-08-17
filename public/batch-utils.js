export const ISBN_PATTERN = /^(?:97[89]\d{10}|\d{9}[\dX])$/;

export function parseBatchIsbns(value, maximum = 10) {
  const candidates = String(value || "").split(/[\s,;]+/)
    .map(item => item.replace(/[^0-9X]/gi, "").toUpperCase()).filter(Boolean);
  const valid = [...new Set(candidates.filter(item => ISBN_PATTERN.test(item)))];
  return { valid:valid.slice(0, maximum), invalid:candidates.filter(item => !ISBN_PATTERN.test(item)), excess:Math.max(0, valid.length - maximum) };
}

export async function runPool(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length:Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) await worker(items[cursor++]);
  });
  await Promise.all(runners);
}
