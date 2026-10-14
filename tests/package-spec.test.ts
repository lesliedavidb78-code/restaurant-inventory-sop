import { describe, expect, it } from "vitest";
import { parsePackageSpecification } from "@/lib/domain/package-spec";
import { calculateRawInputQuantity, convertRecipeQuantityToStockUnit } from "@/lib/domain/recipe";

describe("包装规格和配方进料率", () => {
  it("将 5kg/4袋 拆为 1 件 = 4 袋、每袋 5kg", () => {
    expect(parsePackageSpecification("5KG/4袋", "件", "件")).toEqual({ purchaseUom: "件", stockUom: "袋", unitsPerPurchase: 4, unitNetContent: 5, contentUom: "kg" });
  });

  it("识别单袋规格 20kg/袋，保留一件一袋的采购关系", () => {
    expect(parsePackageSpecification("20KG/袋", "件", "件")).toEqual({ purchaseUom: "件", stockUom: "袋", unitsPerPurchase: 1, unitNetContent: 20, contentUom: "kg" });
  });

  it("进料率 90% 时按原料投料量换算理论耗用", () => {
    const raw = calculateRawInputQuantity(100, 90);
    expect(raw).toBe(111.111111);
    expect(convertRecipeQuantityToStockUnit({ sourceQuantity: raw, sourceUom: "g", stockUom: "袋", unitNetContent: 5, contentUom: "kg", specification: "5kg/4袋" })).toEqual({ stockQuantity: 0.022222, stockUom: "袋" });
  });
});
