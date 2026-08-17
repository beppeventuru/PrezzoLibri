(() => {
  const { text, money, listing, waitFor, parsers } = globalThis.PrezzoLibriScrapers;
  const isbn13to10 = isbn => {
    if (!/^978\d{10}$/.test(isbn)) return "";
    const core = isbn.slice(3, 12);
    let sum = 0;
    for (let index = 0; index < 9; index++) sum += Number(core[index]) * (10 - index);
    const check = (11 - sum % 11) % 11;
    return core + (check === 10 ? "X" : check);
  };
  const imageUrl = image => {
    if (!image) return "";
    const dynamic = image.getAttribute("data-a-dynamic-image");
    if (dynamic) { try { const urls = Object.keys(JSON.parse(dynamic)); if (urls.length) return urls[0]; } catch {} }
    const srcset = image.getAttribute("srcset") || image.getAttribute("data-srcset") || "";
    const fromSet = srcset.split(",").map(part => part.trim().split(/\s+/)[0]).filter(url => /^https:\/\//i.test(url)).at(-1);
    return fromSet || image.currentSrc || image.src || image.getAttribute("data-src") || "";
  };
  const parseOfferRows = (root, asin, title) => [...root.querySelectorAll("#aod-offer")].flatMap(row => {
    const rowText = row.innerText || text(row);
    const price = money(text(row.querySelector(".a-price .a-offscreen, .aod-offer-price .a-offscreen")) || rowText.match(/([0-9]+[,.][0-9]{2})\s*€/i)?.[1]);
    if (!price) return [];
    const condition = text(row.querySelector("#aod-offer-heading")) || rowText.match(/Usato\s*-\s*[^\r\n]+/)?.[0] || "Usato";
    const seller = text(row.querySelector("#aod-offer-soldBy a, #aod-offer-soldBy .a-color-base")) || rowText.match(/Venditore\s*[\r\n]+([^\r\n]+)/i)?.[1] || "";
    const offerKey = encodeURIComponent(`${seller}|${condition}|${price.toFixed(2)}`.toLocaleLowerCase("it"));
    return [listing("amazon", `${title}${seller ? ` — ${seller}` : ""}`, price, `https://www.amazon.it/gp/offer-listing/${asin}?condition=used#${offerKey}`, condition, 0, "active", "exact")];
  });
  const loadAllRows = async () => {
    const scope = document.querySelector("#aod-container, #all-offers-display, #aod-offer-list");
    if (!scope) return { declared:0, counts:[0], loaded:0, scrollers:[] };
    const declared = money((scope.innerText || document.body.innerText || "").match(/(\d+)\s+opzioni/i)?.[1]);
    const counts = [];
    const scrollerLog = [];
    const candidates = () => {
      const found = new Set([document.querySelector("#all-offers-display-scroller"), document.querySelector("#aod-offer-list"), document.querySelector("#all-offers-display"), document.querySelector("#aod-container")].filter(Boolean));
      let node = document.querySelector("#aod-offer")?.parentElement;
      while (node && node !== document.body) { if (node.scrollHeight > node.clientHeight + 20) found.add(node); node = node.parentElement; }
      return [...found].filter(node => node.scrollHeight > node.clientHeight + 20).sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    };
    let stable = 0;
    for (let round = 0; round < 24; round++) {
      const rows = [...document.querySelectorAll("#aod-offer")];
      const count = rows.length;
      counts.push(count);
      if (declared && count >= declared) break;
      const scrollers = candidates();
      scrollerLog.push(scrollers.map(node => ({ id:node.id || "", class:String(node.className || "").slice(0, 80), top:Math.round(node.scrollTop), height:node.clientHeight, scrollHeight:node.scrollHeight })));
      for (const container of scrollers) {
        const step = Math.max(300, Math.floor(container.clientHeight * .82));
        container.scrollTop = Math.min(container.scrollHeight, container.scrollTop + step);
        container.dispatchEvent(new Event("scroll", { bubbles:true }));
        container.dispatchEvent(new WheelEvent("wheel", { bubbles:true, cancelable:true, deltaY:step, deltaMode:0 }));
      }
      rows.at(-1)?.scrollIntoView({ block:"end", inline:"nearest" });
      await new Promise(resolve => setTimeout(resolve, 1800));
      const next = document.querySelectorAll("#aod-offer").length;
      stable = next > count ? 0 : stable + 1;
      if (stable >= 5) break;
    }
    return { declared, counts, loaded:document.querySelectorAll("#aod-offer").length, scrollers:scrollerLog.at(-1) || [] };
  };

  parsers.amazonSearch = async ({ isbn }) => {
    const asin = isbn13to10(isbn);
    const cards = [...document.querySelectorAll('[data-component-type="s-search-result"][data-asin]')];
    const expected = document.querySelector(`[data-component-type="s-search-result"][data-asin="${asin}"]`) || cards[0];
    if (!expected) { Object.assign(globalThis.__prezzoLog, { asin, searchCards:cards.length, exactCardFound:false, coverStage:"nessuna scheda Amazon" }); return []; }
    const image = expected.querySelector("img.s-image, img[data-image-latency], img");
    const title = text(expected.querySelector("h2"));
    const price = money(text(expected.querySelector(".a-price .a-offscreen")));
    const link = expected.querySelector('a[href*="/dp/"]')?.href;
    const coverUrl = imageUrl(image);
    Object.assign(globalThis.__prezzoLog, {
      asin, searchCards:cards.length, cardAsin:expected.dataset.asin || "", exactCardFound:expected.dataset.asin === asin,
      imageFound:Boolean(image), imageSrc:image?.getAttribute("src") || "", imageCurrentSrc:image?.currentSrc || "",
      imageDataSrc:image?.getAttribute("data-src") || "", imageSrcset:(image?.getAttribute("srcset") || image?.getAttribute("data-srcset") || "").slice(0, 500),
      imageDynamic:(image?.getAttribute("data-a-dynamic-image") || "").slice(0, 500), coverUrl, coverFound:Boolean(coverUrl),
      coverStage:coverUrl ? "estratta dalla ricerca Amazon" : "immagine trovata senza URL utilizzabile"
    });
    if (!price || !link) return [];
    return [{ ...listing("amazon", title, price, link, "Nuovo", 0, "active", asin && expected.dataset.asin === asin ? "exact" : "high"), coverUrl }];
  };

  parsers.amazonOffers = async ({ isbn }) => {
    const asin = isbn13to10(isbn);
    const title = text(document.querySelector("#productTitle")) || "Offerta Amazon usata";
    globalThis.__prezzoLog = { mode:"offers", asin, pageRows:document.querySelectorAll("#aod-offer").length };
    const labelled = document.querySelector('[aria-label*="Altri Usato" i]') || [...document.querySelectorAll("a,button,span")].find(node => /Altri\s+Usato/i.test(text(node)) && text(node).length < 180);
    const trigger = labelled?.closest("a,button") || document.querySelector(".aod-popover-caret-link");
    trigger?.dispatchEvent(new MouseEvent("click", { bubbles:true, cancelable:true, view:window }));
    await new Promise(resolve => setTimeout(resolve, 700));
    const formatLink = document.querySelector('[data-action="show-all-offers-display"] a, a[href*="/gp/offer-listing/"][href*="condition=used"]');
    if (formatLink && formatLink.closest('[data-action="show-all-offers-display"]')) formatLink.dispatchEvent(new MouseEvent("click", { bubbles:true, cancelable:true, view:window }));
    if (trigger) await waitFor("#aod-offer, #aod-offer-list", 10000);
    const loading = await loadAllRows();
    const offers = parseOfferRows(document, asin, title);
    Object.assign(globalThis.__prezzoLog, { triggerFound:Boolean(trigger), formatLinkFound:Boolean(formatLink), ...loading, domOffers:offers.length });
    if (offers.length) return offers;
    const pageText = document.body.innerText || "";
    const generic = [];
    const seen = new Set();
    for (const match of pageText.matchAll(/(Usato\s*-\s*[^\r\n]+)[\s\r\n]*([0-9]+(?:[,.][0-9]{2}))\s*€/gi)) {
      const condition = match[1].trim();
      const price = money(match[2]);
      const key = `${condition}|${price}`;
      if (!price || seen.has(key)) continue;
      seen.add(key);
      generic.push(listing("amazon", title, price, `https://www.amazon.it/gp/offer-listing/${asin}?condition=used#offer-${generic.length + 1}`, condition, 0, "active", "exact"));
    }
    const minimumPrice = money(pageText.match(/Altri\s+Usato[^\n]*?da\s+([0-9.,]+)\s*€/i)?.[1]);
    if (minimumPrice && !generic.some(item => item.price === minimumPrice)) generic.unshift(listing("amazon", `${title} — offerta usata più economica`, minimumPrice, `https://www.amazon.it/gp/offer-listing/${asin}?condition=used#minimum`, "Usato - prezzo minimo", 0, "active", "exact"));
    Object.assign(globalThis.__prezzoLog, { textLength:pageText.length, genericOffers:generic.length, minimumPrice });
    return generic;
  };
})();
