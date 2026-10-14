import { describe, expect, it } from "vitest";
import { calculateTheoreticalConsumption, calculateVariance } from "@/lib/domain/theoretical-consumption";

describe("销售理论耗用", () => {
  it("按销售份数和配方最小库存单位用量汇总原料，不改变实际库存", () => {
    const rows = calculateTheoreticalConsumption({
      salesQuantity: 3,
      recipeId: "recipe-beef",
      lines: [
        { itemId: "beef", stockQuantity: 0.1, conversionStatus: "ready" },
        { itemId: "oil", stockQuantity: 0.02, conversionStatus: "ready" },
        { itemId: "pending", stockQuantity: 0, conversionStatus: "pending" },
      ],
    });
    expect(rows).toEqual([
      { itemId: "beef", recipeId: "recipe-beef", quantity: 0.3 },
      { itemId: "oil", recipeId: "recipe-beef", quantity: 0.06 },
    ]);
  });

  it("按理论耗用、实际出库和报损得到可解释的差异", () => {
    expect(calculateVariance({ theoretical: 10, manualOutbound: 11, waste: 1, countAdjustment: -0.5 })).toEqual({
      actualConsumption: 12,
      variance: 2,
      countAdjustment: -0.5,
    });
  });
});
