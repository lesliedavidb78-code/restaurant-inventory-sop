import { describe, expect, test } from "vitest";
import { calculateReplenishment, resolveCategorySettings } from "@/lib/domain/replenishment";

describe("动态库存预警", () => {
  test("数据不足三个完整月时按已有全部自然日计算日均", () => {
    const result = calculateReplenishment({
      asOfDate: "2026-08-16",
      currentQuantity: 25,
      warningDays: 15,
      targetDays: 30,
      factor: 1.2,
      events: [
        { businessDate: "2026-08-01", eventType: "issue", quantityChange: -75 },
      ],
    });

    expect(result.historyMode).toBe("available_days");
    expect(result.historyDays).toBe(15);
    expect(result.averageDailyUsage).toBe(5);
    expect(result.warningQuantity).toBe(75);
    expect(result.targetQuantity).toBe(180);
    expect(result.suggestedPurchaseQuantity).toBe(155);
    expect(result.isWarning).toBe(true);
  });

  test("有完整历史时只用最近三个完整自然月", () => {
    const result = calculateReplenishment({
      asOfDate: "2026-08-14",
      currentQuantity: 150,
      warningDays: 15,
      targetDays: 30,
      factor: 1.2,
      events: [
        { businessDate: "2026-04-01", eventType: "issue", quantityChange: -999 },
        { businessDate: "2026-05-01", eventType: "issue", quantityChange: -920 },
        { businessDate: "2026-08-05", eventType: "issue", quantityChange: -500 },
      ],
    });

    expect(result.historyMode).toBe("three_complete_months");
    expect(result.historyStart).toBe("2026-05-01");
    expect(result.historyEnd).toBe("2026-07-31");
    expect(result.historyDays).toBe(92);
    expect(result.averageDailyUsage).toBe(10);
    expect(result.warningQuantity).toBe(150);
    expect(result.targetQuantity).toBe(360);
    expect(result.suggestedPurchaseQuantity).toBe(210);
    expect(result.isWarning).toBe(true);
  });

  test("正常消耗按销售和领料减退料计算并排除报损调拨", () => {
    const result = calculateReplenishment({
      asOfDate: "2026-08-05",
      currentQuantity: 50,
      warningDays: 3,
      targetDays: 7,
      factor: 1.2,
      events: [
        { businessDate: "2026-08-01", eventType: "sale", quantityChange: -10 },
        { businessDate: "2026-08-01", eventType: "issue", quantityChange: -12 },
        { businessDate: "2026-08-02", eventType: "issue_return", quantityChange: 2 },
        { businessDate: "2026-08-03", eventType: "waste", quantityChange: -100 },
        { businessDate: "2026-08-04", eventType: "transfer_out", quantityChange: -100 },
      ],
    });

    expect(result.historyDays).toBe(4);
    expect(result.netUsage).toBe(20);
    expect(result.averageDailyUsage).toBe(5);
    expect(result.warningQuantity).toBe(15);
    expect(result.targetQuantity).toBe(42);
    expect(result.suggestedPurchaseQuantity).toBe(0);
    expect(result.isWarning).toBe(false);
  });

  test("没有正常出库数据时显示数据不足且不误报", () => {
    const result = calculateReplenishment({
      asOfDate: "2026-08-14",
      currentQuantity: 0,
      warningDays: 15,
      targetDays: 30,
      factor: 1.2,
      events: [
        { businessDate: "2026-08-01", eventType: "purchase", quantityChange: 10 },
      ],
    });

    expect(result.historyMode).toBe("no_data");
    expect(result.averageDailyUsage).toBe(0);
    expect(result.suggestedPurchaseQuantity).toBe(0);
    expect(result.isWarning).toBe(false);
  });
});

describe("分类默认补货参数", () => {
  test("选择已有分类时带出该分类最近保存的参数", () => {
    expect(resolveCategorySettings(" 公司产品 ", [
      { name: "公司产品", warningDays: 15, targetDays: 30, factor: 1.2 },
      { name: "冻货", warningDays: 3, targetDays: 7, factor: 1.2 },
    ])).toEqual({ warningDays: 15, targetDays: 30, factor: 1.2 });
  });

  test("输入新分类时保留上一次使用的参数", () => {
    expect(resolveCategorySettings("地采", [], { warningDays: 15, targetDays: 30, factor: 1.2 }))
      .toEqual({ warningDays: 15, targetDays: 30, factor: 1.2 });
  });
});
