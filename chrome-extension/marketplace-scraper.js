const scrapers = globalThis.PrezzoLibriScrapers;

function diagnostics(message, listings) {
  return {
    platform:message.platform,
    mode:message.mode || "default",
    url:location.href,
    title:document.title,
    ready:document.readyState,
    results:listings.length,
    links:document.querySelectorAll('[data-test-id="listing-title-link"]').length,
    bookLinks:[...document.querySelectorAll('a[href*="/bd"]')].filter(link => /\/\d+\/bd(?:[?#]|$)/i.test(link.href)).length,
    prices:document.querySelectorAll('[data-test-id^="item-price-"]').length,
    jsonLd:document.querySelectorAll('script[type="application/ld+json"]').length,
    body:document.body?.innerText?.length || 0,
    challenge:/captcha|robot|access denied|non sei un robot/i.test(document.body?.innerText || ""),
    ...globalThis.__prezzoLog
  };
}

function parserFor(message) {
  if (message.platform === "amazon") return message.mode === "offers" ? scrapers.parsers.amazonOffers : scrapers.parsers.amazonSearch;
  return scrapers.parsers[message.platform];
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PREZZOLIBRI_NAVIGATE_LIBRACCIO") {
    const input = document.querySelector("#ctl00_ctl00_C_Search1_MainSearch");
    const form = input?.form || document.querySelector("#aspnetForm");
    const eventTarget = form?.querySelector('input[name="__EVENTTARGET"]');
    const eventArgument = form?.querySelector('input[name="__EVENTARGUMENT"]');
    if (!input || !form || !eventTarget) { sendResponse({ started:false }); return; }
    input.value = message.isbn;
    eventTarget.value = "ctl00$ctl00$C$Search1$MainSearch_crsubmit";
    if (eventArgument) eventArgument.value = "";
    input.dispatchEvent(new Event("input", { bubbles:true }));
    sendResponse({ started:true });
    HTMLFormElement.prototype.submit.call(form);
    return;
  }
  if (message.type === "PREZZOLIBRI_NAVIGATE_IBS") {
    const link = document.querySelector(`a.cc-title[href*="/e/${message.isbn}"], a[href*="/e/${message.isbn}"][href*="inventoryId="]`);
    sendResponse({ url:link?.href || "" });
    return;
  }
  if (message.type !== "PREZZOLIBRI_SCRAPE") return;
  globalThis.__prezzoLog = {};
  const parser = parserFor(message);
  if (!parser) { sendResponse({ listings:[], diagnostics:{ platform:message.platform, error:"Parser non disponibile" } }); return; }
  Promise.resolve(parser(message)).then(listings => sendResponse({ listings, diagnostics:diagnostics(message, listings) }));
  return true;
});
