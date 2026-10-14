import { describe, expect, it } from "vitest";
import { calculateReceiptBalance, convertReceiptReturn } from "@/lib/domain/purchase-flow";

describe("采购收货与退货", () => {
  it("退货使用原收货每件十袋快照，不受当前包装二十袋影响", () => {
    expect(convertReceiptReturn(1, { conversionFactor: 10, unitCostCents: 35, totalCostCents: 350, receivedQuantity: 1 })).toEqual({ stockQuantity: 10, conversionFactor: 10, stockUnitCostCents: 35, totalCostCents: 350 });
  });
  it("分批收货后只允许退回已收未退数量", () => {
    expect(calculateReceiptBalance({ orderedQuantity: 10, receivedQuantity: 6, returnedQuantity: 2 })).toEqual({ pendingQuantity: 4, returnableQuantity: 4 });
  });

  it("退货数量不能超过已收未退数量", () => {
    expect(() => calculateReceiptBalance({ orderedQuantity: 10, receivedQuantity: 4, returnedQuantity: 5 })).toThrow("退货数量不能超过已收未退数量");
  });
});
