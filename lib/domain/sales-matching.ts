export type SalesDish = { sku?: string; name: string };
export type RecipeSalesBinding = { id: string; name: string; salesSku?: string; salesName?: string };

function normalized(value?: string) {
  return (value ?? "").toLocaleLowerCase().replace(/[\s\-—_()（）【】\[\]·]/g, "");
}

/** POS identifiers are opaque: only trim/case-fold; '-' and '_' may distinguish SKUs. */
export function normalizeSalesSku(value?: string) { return (value ?? "").trim().toLocaleLowerCase(); }

/**
 * 销售导入的匹配顺序：编码精确匹配 > 菜名精确匹配 > 菜名包含关系。
 * 相似名称只能作为候选，永远不直接写入或扣减，必须由门店确认。
 */
export function suggestSalesRecipeMatches(dish: SalesDish, recipes: RecipeSalesBinding[]) {
  const sku = normalizeSalesSku(dish.sku);
  const name = normalized(dish.name);
  return recipes.map((recipe) => {
    const recipeSku = normalizeSalesSku(recipe.salesSku);
    const recipeName = normalized(recipe.salesName || recipe.name);
    let score = 0;
    let method: "sku_exact" | "name_exact" | "name_contains" | "none" = "none";
    if (sku && recipeSku && sku === recipeSku) { score = 100; method = "sku_exact"; }
    else if (name && recipeName && name === recipeName) { score = 98; method = "name_exact"; }
    else if (name && recipeName && (name.includes(recipeName) || recipeName.includes(name))) {
      score = Math.round((Math.min(name.length, recipeName.length) / Math.max(name.length, recipeName.length)) * 80);
      method = "name_contains";
    }
    return { recipeId: recipe.id, recipeName: recipe.name, score, method, requiresConfirmation: true };
  }).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score || a.recipeName.localeCompare(b.recipeName, "zh-CN"));
}
