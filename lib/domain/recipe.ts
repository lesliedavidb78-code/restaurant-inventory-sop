export type RecipeUnitConversionInput = {
  sourceQuantity: number;
  sourceUom: string;
  stockUom: string;
  unitNetContent: number;
  contentUom: string;
  specification?: string;
};

/** 进料率以百分数传入：90 表示 100g 可用量需投入约 111.111g 原料。 */
export function calculateRawInputQuantity(usableQuantity: number, yieldRatePercent = 100) {
  const quantity = Number(usableQuantity);
  const rate = Number(yieldRatePercent);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("配方用量必须大于 0。");
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) throw new Error("进料率必须大于 0 且不超过 100%。");
  return rounded(quantity / (rate / 100));
}

type UnitFamily = "mass" | "volume" | "count";

const unitAliases: Record<string, { family: UnitFamily; factor: number }> = {
  g: { family: "mass", factor: 1 }, 克: { family: "mass", factor: 1 },
  kg: { family: "mass", factor: 1000 }, 千克: { family: "mass", factor: 1000 }, 公斤: { family: "mass", factor: 1000 },
  斤: { family: "mass", factor: 500 },
  两: { family: "mass", factor: 50 },
  ml: { family: "volume", factor: 1 }, 毫升: { family: "volume", factor: 1 },
  l: { family: "volume", factor: 1000 }, L: { family: "volume", factor: 1000 }, 升: { family: "volume", factor: 1000 },
  个: { family: "count", factor: 1 }, 只: { family: "count", factor: 1 }, 份: { family: "count", factor: 1 },
  包: { family: "count", factor: 1 }, 袋: { family: "count", factor: 1 }, 盒: { family: "count", factor: 1 }, 瓶: { family: "count", factor: 1 },
};

function unitInfo(value: string) {
  // Windows/Excel 导入的单位常见为 `KG`、`Kg`，单位大小写不应影响换算。
  return unitAliases[value.trim().toLocaleLowerCase()] ?? null;
}

function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

type NetContent = { quantity: number; uom: string };

/** 从“1件=10×1kg”“10袋*500g”等常见规格中取出每最小库存单位的净含量。 */
function netContentFromSpecification(specification?: string): NetContent | null {
  const text = (specification ?? "").toLowerCase().replace(/[×＊]/g, "x").replace(/\s+/g, "");
  const unit = "kg|千克|公斤|斤|两|g|克|ml|毫升|l|升";
  const count = "(?:件|箱|袋|包|盒|瓶|个|只|份|条|块|片)?";
  let match = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)${count}[x*](\\d+(?:\\.\\d+)?)(${unit})`));
  if (match) return { quantity: Number(match[1]) * Number(match[2]), uom: match[3] };
  match = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)(${unit})[x*](\\d+(?:\\.\\d+)?)${count}`));
  if (match) return { quantity: Number(match[1]) * Number(match[3]), uom: match[2] };
  match = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)(${unit})/(?:件|箱|袋|包|盒|瓶|个|只|份|条|块|片)`));
  return match ? { quantity: Number(match[1]), uom: match[2] } : null;
}

/**
 * 将 SOP 的原始用量统一换算为商品的最小库存单位。
 * 不支持的或跨维度单位必须报错，宁可要求人工确认，也不能错误扣减库存。
 */
export function convertRecipeQuantityToStockUnit(input: RecipeUnitConversionInput) {
  const quantity = Number(input.sourceQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("配方用量必须大于 0。");
  if (input.sourceUom.trim() === input.stockUom.trim()) return { stockQuantity: rounded(quantity), stockUom: input.stockUom.trim() };

  const source = unitInfo(input.sourceUom);
  const stock = unitInfo(input.stockUom);
  // 两端本身就是同一计量维度时，直接按标准单位换算。
  // 例如 g → KG、两 → 斤；不应再依赖“净含量单位”是否曾被历史数据误填为“件”。
  if (source && stock && source.family === stock.family && source.family !== "count") {
    const stockQuantity = quantity * source.factor / stock.factor;
    if (!Number.isFinite(stockQuantity) || stockQuantity <= 0) throw new Error("配方单位换算结果无效。");
    return { stockQuantity: rounded(stockQuantity), stockUom: input.stockUom.trim() };
  }

  const parsedContent = netContentFromSpecification(input.specification);
  const storedContent = unitInfo(input.contentUom);
  // 已建档的净含量优先；若历史档案误填为“件/袋”等计数单位，则以规格中的质量/体积为准。
  const content = parsedContent && (!storedContent || storedContent.family === "count") ? unitInfo(parsedContent.uom) : storedContent;
  const unitsPerStock = parsedContent && (!storedContent || storedContent.family === "count") ? parsedContent.quantity : Number(input.unitNetContent);
  // “袋/瓶/份”不是互为别名。只有档案明确记载“每库存单位含 N 个原始计数单位”时才可换算。
  if (source?.family === "count" && input.sourceUom.trim() !== input.contentUom.trim()) {
    throw new Error(`无法换算“${input.sourceUom}”到“${input.stockUom}”，不同包装没有明确换算关系，请补全每最小库存单位的净含量。`);
  }
  if (!source || !content || !Number.isFinite(unitsPerStock) || unitsPerStock <= 0) {
    throw new Error(`无法换算“${input.sourceUom}”到“${input.stockUom}”，请在商品建档中补全净含量和单位。`);
  }
  if (source.family !== content.family) {
    throw new Error(`无法换算“${input.sourceUom}”到“${input.stockUom}”，原始单位与商品净含量单位不一致。`);
  }

  // 若库存单位本身也可归入同一维度（如斤、kg），优先直接换算；
  // 否则按“一最小库存单位含多少净含量”进行换算（如袋、盒、瓶）。
  const stockQuantity = stock && stock.family === source.family && source.family !== "count"
    ? quantity * source.factor / stock.factor
    : quantity * source.factor / (unitsPerStock * content.factor);
  if (!Number.isFinite(stockQuantity) || stockQuantity <= 0) throw new Error("配方单位换算结果无效。");
  return { stockQuantity: rounded(stockQuantity), stockUom: input.stockUom.trim() };
}
