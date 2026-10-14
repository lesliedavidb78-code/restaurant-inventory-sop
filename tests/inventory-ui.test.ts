import { describe, expect, it } from "vitest";
import { eventNeedsPurchasePrice, pageSlice, searchInventoryItems, searchStockRecords, weightedAverageCostCents } from "@/lib/domain/inventory-ui";
import { nextSkuForName, skuPrefixFromName } from "@/lib/domain/sku";

describe("库存界面规则", () => {
  it("只有采购入库显示并提交采购单价", () => {
    expect(eventNeedsPurchasePrice("purchase")).toBe(true);
    for (const eventType of ["sale", "issue", "waste", "transfer_out", "issue_return", "transfer_in", "adjustment"]) {
      expect(eventNeedsPurchasePrice(eventType)).toBe(false);
    }
  });

  it("库存总览按 10、20、50 条分页且页码自动收敛", () => {
    const rows = Array.from({ length: 68 }, (_, index) => index + 1);
    expect(pageSlice(rows, 1, 10)).toMatchObject({ rows: rows.slice(0, 10), page: 1, totalPages: 7 });
    expect(pageSlice(rows, 4, 20)).toMatchObject({ rows: rows.slice(60, 68), page: 4, totalPages: 4 });
    expect(pageSlice(rows, 99, 50)).toMatchObject({ rows: rows.slice(50, 68), page: 2, totalPages: 2 });
  });

  it("库存清理、最近录入和商品管理可复用同一分页规则", () => {
    const rows = Array.from({ length: 389 }, (_, index) => ({ id: index + 1 }));
    expect(pageSlice(rows, 1, 20)).toMatchObject({ page: 1, pageSize: 20, totalRows: 389, totalPages: 20 });
    expect(pageSlice(rows, 20, 20).rows).toHaveLength(9);
    expect(pageSlice([], 3, 10)).toMatchObject({ rows: [], page: 1, totalRows: 0, totalPages: 1 });
  });

  it("多个仓库的平均成本按现存数量加权计算", () => {
    expect(weightedAverageCostCents([
      { quantity: 10, averageCostCents: 1000 },
      { quantity: 5, averageCostCents: 1600 },
      { quantity: 0, averageCostCents: 999999 },
    ])).toBe(1200);
    expect(weightedAverageCostCents([])).toBe(0);
    expect(weightedAverageCostCents([{ quantity: 1000, averageCostCents: 3.5 }])).toBe(3.5);
  });

  it("商品关键词同时匹配名称、SKU、分类和规格", () => {
    const items = [
      { name: "红油", sku: "HY-001", category: "公司产品", specification: "瓶装" },
      { name: "红烧鸡爪", sku: "HSJZ-001", category: "冻货", specification: "袋装" },
      { name: "牛肉", sku: "NR-001", category: "肉品", specification: "1kg" },
    ];
    expect(searchInventoryItems(items, "红").map((item) => item.name)).toEqual(["红油", "红烧鸡爪"]);
    expect(searchInventoryItems(items, "NR-001").map((item) => item.name)).toEqual(["牛肉"]);
    expect(searchInventoryItems(items, "冻货").map((item) => item.name)).toEqual(["红烧鸡爪"]);
  });

  it("录入记录可按商品、SKU、日期和备注搜索", () => {
    const records = [
      { itemName: "牛肉", sku: "NR-001", eventType: "purchase", businessDate: "2026-08-15", warehouseName: "门店总仓", note: "测试入库" },
      { itemName: "辣椒", sku: "LJ-001", eventType: "issue", businessDate: "2026-08-14", warehouseName: "门店总仓", note: "厨房领料" },
    ];
    expect(searchStockRecords(records, "测试")).toEqual([records[0]]);
    expect(searchStockRecords(records, "LJ-001")).toEqual([records[1]]);
    expect(searchStockRecords(records, "2026-08-15")).toEqual([records[0]]);
  });

  it("商品名称按拼音首字母自动生成连续 SKU", () => {
    expect(skuPrefixFromName("牛肉")).toBe("NR");
    expect(nextSkuForName("牛肉", [])).toBe("NR-001");
    expect(nextSkuForName("牛肉", ["NR-001", "NR-003", "OTHER-001"])).toBe("NR-004");
    expect(nextSkuForName("红烧鸡爪", [])).toBe("HSJZ-001");
  });
});
