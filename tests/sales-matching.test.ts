import { describe, expect, it } from "vitest";
import { suggestSalesRecipeMatches } from "@/lib/domain/sales-matching";

describe("销售菜品与配方匹配", () => {
  it("优先销售 SKU 精确匹配", () => {
    const result = suggestSalesRecipeMatches({ sku: "MT-100", name: "鸡蛋嫩牛肉" }, [{ id: "r1", name: "嫩牛肉", salesSku: "MT-100" }]);
    expect(result[0]).toMatchObject({ method: "sku_exact", score: 100, requiresConfirmation: true });
  });
  it("将包含关系作为待人工确认的候选", () => {
    const result = suggestSalesRecipeMatches({ name: "鸡蛋嫩牛肉" }, [{ id: "r1", name: "嫩牛肉" }]);
    expect(result[0]).toMatchObject({ method: "name_contains", requiresConfirmation: true });
  });
  it("销售编码中的连接符和下划线不被当作可忽略标点", () => {
    const result = suggestSalesRecipeMatches({ sku: "AB-1", name: "外部菜名" }, [{ id: "plain", name: "菜一", salesSku: "AB1" }, { id: "exact", name: "菜二", salesSku: "AB-1" }, { id: "underscore", name: "菜三", salesSku: "AB_1" }]);
    expect(result.map((row) => row.recipeId)).toEqual(["exact"]);
  });
});
