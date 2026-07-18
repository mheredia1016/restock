import * as cheerio from "cheerio";

export function validateProductUrl(value) {
  const url = new URL(value);
  if (!/^(www\.)?microcenter\.com$/i.test(url.hostname)) throw new Error("Only Micro Center product URLs are supported right now.");
  if (!url.pathname.startsWith("/product/")) throw new Error("Paste a full Micro Center product page URL.");
  return url.toString();
}

function clean(value) { return value?.replace(/\s+/g, " ").trim() || null; }

export async function checkProduct(url, storeName) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; RestockDashboard/2.0)",
      "accept-language": "en-US,en;q=0.9"
    },
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error(`Micro Center returned HTTP ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  const text = clean($("body").text()) || "";
  const title = clean($("h1").first().text()) || clean($("meta[property='og:title']").attr("content")) || "Micro Center Product";
  const image = $("meta[property='og:image']").attr("content") || null;
  const skuMatch = text.match(/SKU:\s*([A-Z0-9-]+)/i) || text.match(/SKU\s*([A-Z0-9-]+)/i);
  const priceMatch = text.match(/\$\s?\d{1,4}(?:,\d{3})*(?:\.\d{2})?/);
  const escaped = storeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const storeMatch = text.match(new RegExp(`${escaped}\\s*\\((in stock|out of stock|limited availability|sold out)\\)`, "i"));
  let status = "unknown";
  if (storeMatch) {
    const raw = storeMatch[1].toLowerCase();
    status = raw === "in stock" || raw === "limited availability" ? "in_stock" : "out_of_stock";
  }
  return {
    title,
    url,
    storeName,
    status,
    price: priceMatch?.[0]?.replace(/\s/g, "") || null,
    sku: skuMatch?.[1] || null,
    image,
    checkedAt: new Date().toISOString()
  };
}
