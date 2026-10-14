export type RecipeMatchItem = {
  id: string;
  name: string;
  sku: string;
  category?: string;
  active?: number | boolean;
  stockUom?: string;
  unitNetContent?: number;
  contentUom?: string;
  specification?: string;
};

export type RecipeItemMatch = {
  item: RecipeMatchItem | null;
  method: "exact" | "alias" | "fuzzy" | "candidate" | "none";
  score: number;
  candidates: Array<{ item: RecipeMatchItem; score: number }>;
};

const removeNoise = (value: string) => value
  .toLocaleLowerCase()
  .replace(/[\s\-—_()（）【】\[\]·,，.。/\\]/g, "")
  // 品牌或描述性前缀不应阻止原料匹配；不移除原料核心词。
  .replace(/示例品牌|示例供应品牌|专用|小份|大份/g, "");

function diceSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index += 1) {
    const pair = left.slice(index, index + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  let shared = 0;
  for (let index = 0; index < right.length - 1; index += 1) {
    const pair = right.slice(index, index + 2);
    const count = pairs.get(pair) ?? 0;
    if (count) { shared += 1; pairs.set(pair, count - 1); }
  }
  return (2 * shared) / (left.length - 1 + right.length - 1);
}

function scoreName(source: string, target: string) {
  if (!source || !target) return 0;
  if (source === target) return 100;
  if (source.length >= 3 && (source.includes(target) || target.includes(source))) {
    return Math.round((Math.min(source.length, target.length) / Math.max(source.length, target.length)) * 96);
  }
  return Math.round(diceSimilarity(source, target) * 100);
}

/**
 * 配方原料只能自动绑定高置信度名称。低置信度只返回候选，绝不擅自改变库存扣减对象。
 * 导入产生的“SOP原料待完善”占位商品会被排在最后，避免再次匹配到占位商品。
 */
export function matchRecipeIngredient(
  sourceName: string,
  items: RecipeMatchItem[],
  aliases: Record<string, string[]> = {},
): RecipeItemMatch {
  const activeItems = items.filter((item) => item.active !== 0 && item.active !== false);
  const preferredItems = activeItems.filter((item) => item.category !== "SOP原料待完善");
  const pool = preferredItems.length ? preferredItems : activeItems;
  const source = removeNoise(sourceName);
  const exact = pool.find((item) => removeNoise(item.name) === source);
  if (exact) return { item: exact, method: "exact", score: 100, candidates: [{ item: exact, score: 100 }] };

  const aliasNames = aliases[sourceName] ?? [];
  for (const alias of aliasNames) {
    const match = pool.find((item) => removeNoise(item.name) === removeNoise(alias));
    if (match) return { item: match, method: "alias", score: 99, candidates: [{ item: match, score: 99 }] };
  }

  const candidates = pool.map((item) => ({ item, score: scoreName(source, removeNoise(item.name)) }))
    .filter((candidate) => candidate.score >= 45)
    .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name, "zh-CN"))
    .slice(0, 3);
  const best = candidates[0];
  const next = candidates[1];
  // 92 分以上，且明显优于第二候选，才作为无需人工确认的高置信度匹配。
  if (best && best.score >= 92 && (!next || best.score - next.score >= 8)) {
    return { item: best.item, method: "fuzzy", score: best.score, candidates };
  }
  if (best) return { item: null, method: "candidate", score: best.score, candidates };
  return { item: null, method: "none", score: 0, candidates: [] };
}
