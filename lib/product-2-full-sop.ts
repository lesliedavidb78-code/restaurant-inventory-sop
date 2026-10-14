// Synthetic examples only. Not a restaurant's production SOP or dietary guidance.
export type FullSopIngredient = { name: string; quantity: number; uom: string; yieldRate?: number };
export type FullSopRecipe = { name: string; sourceName: string; ingredients: FullSopIngredient[] };
export const PRODUCT_2_FULL_SOP_RECIPES: FullSopRecipe[] = [
  { name: "虚构示例菜品A", sourceName: "开源虚构样例", ingredients: [{ name: "示例土豆", quantity: 100, uom: "g", yieldRate: 100 }] },
  { name: "虚构示例菜品B", sourceName: "开源虚构样例", ingredients: [{ name: "示例牛肉", quantity: 100, uom: "g", yieldRate: 90 }] },
];
export const PRODUCT_2_SOP_IMPORT_SUMMARY = { recipeCount: 2, lineCount: 2, bySource: { "开源虚构样例": 2 } } as const;
