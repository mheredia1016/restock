import * as cheerio from "cheerio";

const USER_AGENT =
  "Mozilla/5.0 (compatible; PokemonRestockBot/1.0; +https://discord.com)";

export function validateMicroCenterUrl(value) {
  const url = new URL(value);
  if (!["www.microcenter.com", "microcenter.com"].includes(url.hostname.toLowerCase())) {
    throw new Error("Only Micro Center product URLs are supported in version 1.");
  }
  if (!url.pathname.startsWith("/product/")) {
    throw new Error("Please use a Micro Center product page URL.");
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

function getMeta($, selector, attribute = "content") {
  return $(selector).first().attr(attribute)?.trim() || null;
}

function parsePrice(text) {
  const match = text.match(/\$\s?[\d,]+(?:\.\d{2})?/);
  return match ? match[0].replace(/\s/g, "") : null;
}

export async function checkMicroCenterProduct(rawUrl, storeName) {
  const url = validateMicroCenterUrl(rawUrl);
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(25000)
  });

  if (!response.ok) {
    throw new Error(`Micro Center returned HTTP ${response.status}`);
  }

  const html = await response.text();
  if (html.length < 5000) {
    throw new Error("Micro Center returned an unexpectedly short page.");
  }

  const $ = cheerio.load(html);
  const bodyText = normalize($("body").text());

  const title =
    getMeta($, 'meta[property="og:title"]') ||
    $("h1").first().text().trim() ||
    $("title").text().replace(/\s*-\s*Micro Center\s*$/i, "").trim();

  const image =
    getMeta($, 'meta[property="og:image"]') ||
    $("img[itemprop='image']").first().attr("src") ||
    null;

  const skuMatch = bodyText.match(/SKU:\s*0?(\d{4,8})/i);
  const sku = skuMatch ? skuMatch[1] : null;
  const price = parsePrice(bodyText);

  // The page's store picker currently exposes labels such as:
  // "IL - Chicago (out of stock)" or "IL - Chicago (in stock)".
  const escapedStore = storeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const storeRegex = new RegExp(
    `${escapedStore}\\s*\\((in stock|out of stock|limited availability|limited stock|unavailable)\\)`,
    "i"
  );
  const match = bodyText.match(storeRegex);

  let status = "unknown";
  let rawStatus = match?.[1]?.toLowerCase() || null;

  if (rawStatus) {
    if (rawStatus.includes("in stock") || rawStatus.includes("limited")) status = "in_stock";
    else if (rawStatus.includes("out of stock") || rawStatus.includes("unavailable")) status = "out_of_stock";
  } else {
    // Fallback: inspect anchors/options one by one.
    $("a, option, button, li").each((_, element) => {
      if (status !== "unknown") return;
      const text = normalize($(element).text());
      if (!text.toLowerCase().includes(storeName.toLowerCase())) return;
      if (/in stock|limited availability|limited stock/i.test(text)) {
        status = "in_stock";
        rawStatus = text;
      } else if (/out of stock|unavailable/i.test(text)) {
        status = "out_of_stock";
        rawStatus = text;
      }
    });
  }

  return {
    url,
    title: title || "Micro Center Product",
    image,
    sku,
    price,
    status,
    rawStatus,
    storeName,
    checkedAt: new Date().toISOString()
  };
}
