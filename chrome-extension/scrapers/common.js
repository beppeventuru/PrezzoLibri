(() => {
  const text = node => node?.textContent?.replace(/\s+/g, " ").trim() || "";
  const money = value => Number(String(value || "").replace(/\./g, "").replace(",", ".").replace(/[^0-9.]/g, ""));
  const absolute = href => { try { return new URL(href, location.origin).href; } catch { return ""; } };
  const coverImage = platform => platform === "amazon"
    ? document.querySelector("#landingImage, #imgBlkFront, #ebooksImgBlkFront")
    : document.querySelector("#listing_1 img, #imagetype_1, [data-test-id='listing-image-0'] img");
  const listing = (platform, title, price, url, condition = "Usato", shipping = 0, evidenceType = "active", relevance = "high", dateLabel = "") => ({
    platform, title, price, shipping, url, condition, evidenceType, relevance, currency:"EUR", dateLabel,
    ...(["amazon", "abebooks"].includes(platform) ? { coverUrl:coverImage(platform)?.getAttribute("data-old-hires") || coverImage(platform)?.currentSrc || coverImage(platform)?.src || "" } : {})
  });
  const waitFor = (selector, timeout = 8000) => new Promise(resolve => {
    const found = document.querySelector(selector);
    if (found) return resolve(found);
    const observer = new MutationObserver(() => {
      const node = document.querySelector(selector);
      if (node) { observer.disconnect(); clearTimeout(timer); resolve(node); }
    });
    observer.observe(document.documentElement, { childList:true, subtree:true });
    const timer = setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
  });
  const fetchDocument = async url => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { credentials:"include", signal:controller.signal });
      if (!response.ok) return null;
      return new DOMParser().parseFromString(await response.text(), "text/html");
    } catch { return null; }
    finally { clearTimeout(timer); }
  };
  const mapLimited = async (items, limit, worker) => {
    const results = new Array(items.length);
    let cursor = 0;
    await Promise.all(Array.from({ length:Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index], index);
      }
    }));
    return results;
  };
  globalThis.PrezzoLibriScrapers = { text, money, absolute, listing, waitFor, fetchDocument, mapLimited, parsers:{} };
})();
