import { describe, expect, it } from "vitest";
import { applyMovement, calculateCogs, convertToStockUnit } from "@/lib/domain/inventory";

describe("移动加权平均库存", () => {
  it("一袋 1000 克、35 元的单位成本保留 3.5 分，不把整袋变成 40 元", () => {
    expect(convertToStockUnit({ quantity: 1, quantityUom: "purchase", unitsPerPurchase: 1000, unitCostCents: 3500 }).stockUnitCostCents).toBe(3.5);
  });
  it("移动平均不按展示精度取整，最后一笔出库清掉全部 35 元价值", () => {
    let balance=applyMovement({quantity:0,valueCents:0,averageCostCents:0},{type:"purchase",quantity:1000,unitCostCents:3.5});
    expect(balance.averageCostCents).toBe(3.5);
    balance=applyMovement(balance,{type:"issue",quantity:333}); expect(balance.valueCents).toBe(2334);
    balance=applyMovement(balance,{type:"issue",quantity:667}); expect(balance).toEqual({quantity:0,valueCents:0,averageCostCents:0});
  });
  it("在不同采购价入库后按加权成本出库", () => {
    let balance = { quantity: 0, valueCents: 0, averageCostCents: 0 };
    balance = applyMovement(balance, { type: "purchase", quantity: 10, unitCostCents: 100 });
    balance = applyMovement(balance, { type: "purchase", quantity: 10, unitCostCents: 200 });
    expect(balance).toEqual({ quantity: 20, valueCents: 3000, averageCostCents: 150 });
    balance = applyMovement(balance, { type: "issue", quantity: 4 });
    expect(balance).toEqual({ quantity: 16, valueCents: 2400, averageCostCents: 150 });
  });

  it("禁止负库存", () => {
    expect(() => applyMovement({ quantity: 2, valueCents: 200, averageCostCents: 100 }, { type: "waste", quantity: 3 })).toThrow("库存不足");
  });

  it("整箱入库时换算为最小单位和最小单位成本", () => {
    expect(convertToStockUnit({ quantity: 2, quantityUom: "purchase", unitsPerPurchase: 10, unitCostCents: 10_000 })).toEqual({
      conversionFactor: 10,
      stockQuantity: 20,
      stockUnitCostCents: 1_000,
    });
  });

  it("按最小单位出库时不重复换算", () => {
    expect(convertToStockUnit({ quantity: 1, quantityUom: "stock", unitsPerPurchase: 10 })).toEqual({
      conversionFactor: 1,
      stockQuantity: 1,
      stockUnitCostCents: undefined,
    });
  });

  it("按档口公式计算6月锅底销售成本", () => {
    expect(calculateCogs(1_067_776, 8_449_399, 8_070, 1_079_181)).toBe(8_429_924);
  });
});
