import { describe, expect, it } from "vitest";
import { convertRecipeQuantityToStockUnit } from "@/lib/domain/recipe";

describe("配方原料单位换算", () => {
  it("不同计数包装没有明确关系时不推断为 1:1", () => {
    expect(() => convertRecipeQuantityToStockUnit({ sourceQuantity: 2, sourceUom: "包", stockUom: "瓶", unitNetContent: 500, contentUom: "ml" })).toThrow("无法换算");
  });
  it("只有明确净含量关系才允许不同计数单位换算", () => {
    expect(convertRecipeQuantityToStockUnit({ sourceQuantity: 2, sourceUom: "袋", stockUom: "件", unitNetContent: 4, contentUom: "袋" })).toEqual({ stockQuantity: 0.5, stockUom: "件" });
  });
  it("能将 SOP 的克数换算为按斤管理的库存数量", () => {
    expect(convertRecipeQuantityToStockUnit({ sourceQuantity: 100, sourceUom: "g", stockUom: "斤", unitNetContent: 500, contentUom: "g" })).toEqual({ stockQuantity: 0.2, stockUom: "斤" });
  });

  it("能将 SOP 的克数换算为按袋管理且每袋 1kg 的库存数量", () => {
    expect(convertRecipeQuantityToStockUnit({ sourceQuantity: 20, sourceUom: "g", stockUom: "袋", unitNetContent: 1, contentUom: "kg" })).toEqual({ stockQuantity: 0.02, stockUom: "袋" });
  });

  it("单位维度不一致时拒绝保存，避免错误扣库存", () => {
    expect(() => convertRecipeQuantityToStockUnit({ sourceQuantity: 10, sourceUom: "ml", stockUom: "斤", unitNetContent: 500, contentUom: "g" })).toThrow("无法换算");
  });

  it("支持克、两、斤和千克之间的质量换算", () => {
    expect(convertRecipeQuantityToStockUnit({ sourceQuantity: 100, sourceUom: "g", stockUom: "两", unitNetContent: 1, contentUom: "两" })).toEqual({ stockQuantity: 2, stockUom: "两" });
    expect(convertRecipeQuantityToStockUnit({ sourceQuantity: 2, sourceUom: "两", stockUom: "斤", unitNetContent: 1, contentUom: "斤" })).toEqual({ stockQuantity: 0.2, stockUom: "斤" });
    // 真实门店档案中常由 Excel 写成大写 KG，且历史净含量可能误填为“件”。
    // 两端均为质量单位时仍必须直接换算，不能阻塞配方保存。
    expect(convertRecipeQuantityToStockUnit({ sourceQuantity: 130, sourceUom: "g", stockUom: "KG", unitNetContent: 1, contentUom: "件", specification: "1KG/10袋" })).toEqual({ stockQuantity: 0.13, stockUom: "KG" });
  });

  it("历史净含量填为件时，能从 1件=10×1kg 规格读取质量", () => {
    expect(convertRecipeQuantityToStockUnit({ sourceQuantity: 130, sourceUom: "g", stockUom: "件", unitNetContent: 1, contentUom: "件", specification: "1件=10×1kg" })).toEqual({ stockQuantity: 0.013, stockUom: "件" });
  });
});
