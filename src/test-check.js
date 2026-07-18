import "dotenv/config";
import { checkMicroCenterProduct } from "./microcenter.js";

const url =
  process.env.DEFAULT_PRODUCT_URL ||
  "https://www.microcenter.com/product/713503/nintendo-pokemon-mega-evolution-pitch-black-elite-trainer-box";
const store = process.env.MICROCENTER_STORE_NAME || "IL - Chicago";

const result = await checkMicroCenterProduct(url, store);
console.log(JSON.stringify(result, null, 2));
