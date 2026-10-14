import { describe, expect, it } from "vitest";
import { matchRecipeIngredient } from "@/lib/domain/recipe-item-matching";

const items = [
  { id: "stock-1", name: "三鲜骨汤", sku: "X01-009-ITEM", category: "底料调料", active: 1 },
  { id: "stock-2", name: "示例供应品牌三鲜骨汤", sku: "SOP-689", category: "SOP原料待完善", active: 1 },
  { id: "stock-3", name: "三鲜番茄底料", sku: "X01-010", category: "底料调料", active: 1 },
];

describe("SOP 原料智能匹配", () => {
  it("优先匹配实际库存，忽略同名 SOP 占位商品", () => {
    expect(matchRecipeIngredient("示例供应品牌三鲜骨汤", items)).toMatchObject({ item: { id: "stock-1" }, method: "exact" });
  });

  it("支持人工维护的别名", () => {
    expect(matchRecipeIngredient("三鲜底料", items, { "三鲜底料": ["三鲜骨汤"] })).toMatchObject({ item: { id: "stock-1" }, method: "alias" });
  });

  it("相似但不够确定时只返回候选，不自动绑定", () => {
    const result = matchRecipeIngredient("三鲜", items);
    expect(result.item).toBeNull();
    expect(result.method).toBe("candidate");
    expect(result.candidates[0]?.item.id).toBe("stock-1");
  });
});
