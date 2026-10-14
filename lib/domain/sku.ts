import { pinyin } from "pinyin-pro";

export function skuPrefixFromName(name: string) {
  const initials = pinyin(name.trim(), {
    pattern: "first",
    toneType: "none",
    type: "array",
  })
    .join("")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();

  return initials.slice(0, 12) || "SP";
}

export function nextSkuForName(name: string, existingSkus: string[]) {
  const prefix = skuPrefixFromName(name);
  const expression = new RegExp(`^${prefix}-(\\d+)$`, "i");
  let largest = 0;

  for (const sku of existingSkus) {
    const match = sku.trim().match(expression);
    if (match) largest = Math.max(largest, Number(match[1]) || 0);
  }

  return `${prefix}-${String(largest + 1).padStart(3, "0")}`;
}
