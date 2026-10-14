export type RecipeConsumptionLine = {
  itemId: string;
  stockQuantity: number;
  conversionStatus: "ready" | "pending";
};

/**
 * 只生成理论耗用明细，不改变库存流水。
 * stockQuantity 已包含配方进料率折算后的“每销售单位原料投入量”。
 */
export function calculateTheoreticalConsumption(input: { salesQuantity: number; recipeId: string; lines: RecipeConsumptionLine[] }) {
  if (!Number.isFinite(input.salesQuantity) || input.salesQuantity <= 0) throw new Error("销售数量必须大于 0。");
  return input.lines
    .filter((line) => line.conversionStatus === "ready" && Number.isFinite(line.stockQuantity) && line.stockQuantity > 0)
    .map((line) => ({
      itemId: line.itemId,
      recipeId: input.recipeId,
      quantity: Number((input.salesQuantity * line.stockQuantity).toFixed(6)),
    }));
}

/** 差异只用于核对，不回写库存。正数代表实际耗用高于理论耗用。 */
export function calculateVariance(input: { theoretical: number; manualOutbound: number; waste: number; countAdjustment: number }) {
  const actualConsumption = Number((input.manualOutbound + input.waste).toFixed(6));
  return {
    actualConsumption,
    variance: Number((actualConsumption - input.theoretical).toFixed(6)),
    countAdjustment: Number(input.countAdjustment.toFixed(6)),
  };
}
