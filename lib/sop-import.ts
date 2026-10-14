export type SopIngredient = { name: string; quantity: number; uom: string; yieldRate?: number };
export type SopRecipe = { name: string; sourceName: string; ingredients: SopIngredient[] };
export const SMALL_MATERIAL_SOP_RECIPES: SopRecipe[] = [];
// Generic aliases used by matching regression tests; no production quantities.
export const SOP_ITEM_ALIASES: Record<string, string[]> = {
  "芝麻": ["白芝麻"], "黄瓜片": ["黄瓜"], "胡萝卜片": ["胡萝卜"], "食用盐": ["盐"],
  "示例供应品牌三鲜骨汤": ["三鲜骨汤"], "示例供应品牌三鲜底料": ["三鲜骨汤"], "三鲜底料": ["三鲜骨汤"],
};
export { PRODUCT_2_FULL_SOP_RECIPES, PRODUCT_2_SOP_IMPORT_SUMMARY } from "./product-2-full-sop";
