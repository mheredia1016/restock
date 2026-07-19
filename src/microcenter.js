import * as cheerio from "cheerio";

export function detectRetailer(value) {
  const url = value instanceof URL ? value : new URL(value);
  if (/^(www\.)?microcenter\.com$/i.test(url.hostname)) return "Micro Center";
  if (/^(www\.)?target\.com$/i.test(url.hostname)) return "Target";
  return "Unknown";
}

export function validateProductUrl(value) {
  const url = new URL(value);
  const retailer = detectRetailer(url);
  if (retailer === "Micro Center") {
    if (!url.pathname.startsWith("/product/")) throw new Error("Paste a full Micro Center product page URL.");
  } else if (retailer === "Target") {
    if (!/\/p\//i.test(url.pathname) || !/\/A-\d+/i.test(url.pathname)) throw new Error("Paste a full Target product page URL containing /A- followed by the TCIN.");
  } else {
    throw new Error("Supported retailers are Micro Center and Target.");
  }
  url.hash = "";
  if (retailer === "Target") url.search = "";
  return url.toString();
}

function clean(value) { return value?.replace(/\s+/g, " ").trim() || null; }

export async function checkProduct(url, storeName) {
  const retailer = detectRetailer(url);
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; RestockDashboard/3.0)",
      "accept-language": "en-US,en;q=0.9"
    },
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error(`${retailer} returned HTTP ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  const text = clean($("body").text()) || "";
  const title = clean($("h1").first().text()) || clean($("meta[property='og:title']").attr("content")) || `${retailer} Product`;
  const image = $("meta[property='og:image']").attr("content") || null;
  const priceMatch = text.match(/\$\s?\d{1,5}(?:,\d{3})*(?:\.\d{2})?/);
  let sku = null;
  let status = "unknown";
  let availabilityText = null;

  if (retailer === "Micro Center") {
    sku = (text.match(/SKU:\s*([A-Z0-9-]+)/i) || text.match(/SKU\s*([A-Z0-9-]+)/i))?.[1] || null;
    const escaped = String(storeName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const storeMatch = escaped ? text.match(new RegExp(`${escaped}\\s*\\((in stock|out of stock|limited availability|sold out)\\)`, "i")) : null;
    if (storeMatch) {
      const raw = storeMatch[1].toLowerCase();
      status = raw === "in stock" || raw === "limited availability" ? "in_stock" : "out_of_stock";
      availabilityText = storeMatch[0];
    }
  } else if (retailer === "Target") {
    sku = url.match(/\/A-(\d+)/i)?.[1] || text.match(/TCIN\s*:?\s*(\d+)/i)?.[1] || null;
    const lower = text.toLowerCase();
    if (/out of stock|sold out|currently unavailable/.test(lower)) status = "out_of_stock";
    if (/in stock|ship it|shipping available|pick it up|pickup available|add to cart/.test(lower)) status = "in_stock";
    availabilityText = text.match(/(?:in stock|out of stock|shipping available|pickup available|pick it up|ship it|currently unavailable)[^.\n]{0,120}/i)?.[0] || null;
  }

  return {
    title, url, retailer, storeName, status,
    price: priceMatch?.[0]?.replace(/\s/g, "") || null,
    sku, image, availabilityText,
    checkedAt: new Date().toISOString()
  };
}
