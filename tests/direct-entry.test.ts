import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitDirectEntry, previewDirectEntry, type DirectEntryInput } from "@/lib/direct-entry";
import { ensureSchema, sqlite } from "@/lib/db";
import { canUseDirectEntry } from "@/lib/direct-entry-permissions";

const storeId = "direct-entry-test-store";
const boothId = "direct-entry-test-booth";

describe("直接编辑录入权限", () => {
  it("库管不能确认收入和资金录入", () => {
    expect(canUseDirectEntry("storekeeper")).toBe(false);
  });

  it("老板、店长和财务可以直接录入", () => {
    expect(canUseDirectEntry("owner")).toBe(true);
    expect(canUseDirectEntry("manager")).toBe(true);
    expect(canUseDirectEntry("finance")).toBe(true);
  });
});

const baseInput: DirectEntryInput = {
  period: "2026-07",
  sales: { grossRevenueCents: 10_000, netRevenueCents: 9_000, discountCents: 1_000, orderCount: 10 },
  expenses: [{ category: "房租", amountCents: 2_000 }],
  booths: [{ name: "素菜档", grossRevenueCents: 10_000, cogsCents: 4_000 }],
  bankRows: [{ businessDate: "2026-07-01", summary: "营业入账", incomeCents: 9_000, expenseCents: 0 }],
  counterparties: [{ kind: "payable", name: "测试供应商", originalCents: 3_000, settledCents: 1_000 }],
};

describe("direct entry overwrite guards", () => {
  beforeEach(() => {
    ensureSchema();
    sqlite.prepare("DELETE FROM audit_logs WHERE store_id=?").run(storeId);
    sqlite.prepare("DELETE FROM sales_summaries WHERE store_id=?").run(storeId);
    sqlite.prepare("DELETE FROM expense_entries WHERE store_id=?").run(storeId);
    sqlite.prepare("DELETE FROM bank_transactions WHERE store_id=?").run(storeId);
    sqlite.prepare("DELETE FROM counterparties WHERE store_id=?").run(storeId);
    sqlite.prepare("DELETE FROM gross_profit_snapshots WHERE store_id=?").run(storeId);
    sqlite.prepare("DELETE FROM period_closes WHERE store_id=?").run(storeId);
    sqlite.prepare("INSERT OR IGNORE INTO stores (id,name,code,created_at,created_by) VALUES (?,?,?,?,?)").run(storeId, "Direct entry test store", "DIRECT-ENTRY-TEST", new Date().toISOString(), "test");
    sqlite.prepare("INSERT OR IGNORE INTO booths (id,store_id,name,code,active,created_at,created_by) VALUES (?,?,?,?,?,?,?)").run(boothId, storeId, "素菜档", "VEG", 1, new Date().toISOString(), "test");
  });

  it("rejects overwriting non-direct-entry sales for the same store and period", async () => {
    const now = new Date().toISOString();
    sqlite.prepare("INSERT INTO sales_summaries (id,store_id,period,gross_revenue_cents,net_revenue_cents,discount_cents,order_count,source_batch_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run("excel-sales", storeId, "2026-07", 8_000, 8_000, 0, 8, "excel:2026-07", now, "test");

    const preview = previewDirectEntry(baseInput, storeId);
    expect(preview.errors.some((error) => error.includes("非直接录入"))).toBe(true);
    await expect(commitDirectEntry(storeId, "测试财务", baseInput)).rejects.toThrow("非直接录入");
    expect(sqlite.prepare("SELECT source_batch_id FROM sales_summaries WHERE store_id=? AND period=?").get(storeId, "2026-07"))
      .toMatchObject({ source_batch_id: "excel:2026-07" });
  });

  it("includes historical bank transactions but excludes the replaced direct-entry batch", async () => {
    const now = new Date().toISOString();
    sqlite.prepare("INSERT INTO bank_transactions (id,store_id,business_date,summary,income_cents,expense_cents,balance_cents,source_batch_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run("history-bank", storeId, "2026-06-30", "期初余额", 10_000, 0, 10_000, "excel:opening", now, "test");
    await commitDirectEntry(storeId, "测试财务", baseInput);

    const preview = previewDirectEntry({
      ...baseInput,
      bankRows: [{ businessDate: "2026-07-01", summary: "修正营业入账", incomeCents: 5_000, expenseCents: 0 }],
    }, storeId);

    expect(preview.bankBalanceCents).toBe(15_000);
  });

  it("accepts signed integer adjustments and rejects fractional adjustments", () => {
    const invalid = previewDirectEntry({ ...baseInput, booths: [{ ...baseInput.booths[0], adjustmentCents: 1.5 }] });
    const valid = previewDirectEntry({ ...baseInput, booths: [{ ...baseInput.booths[0], adjustmentCents: -100 }] });

    expect(invalid.errors.some((error) => error.includes("调整金额必须为整数"))).toBe(true);
    expect(valid.errors.some((error) => error.includes("调整金额必须为整数"))).toBe(false);
  });
});

beforeEach(() => {
  ensureSchema();
  sqlite.prepare("INSERT OR IGNORE INTO stores (id,name,code,created_at,created_by) VALUES (?,?,?,?,?)").run(storeId, "直接录入测试店", "DIRECT-ENTRY-TEST", new Date().toISOString(), "test");
  sqlite.prepare("INSERT OR IGNORE INTO booths (id,store_id,name,code,active,created_at,created_by) VALUES (?,?,?,?,?,?,?)").run(boothId, storeId, "素菜档", "VEG", 1, new Date().toISOString(), "test");
});

afterEach(() => {
  for (const table of ["audit_logs", "sales_summaries", "expense_entries", "bank_transactions", "counterparties", "gross_profit_snapshots", "period_closes"]) {
    sqlite.prepare(`DELETE FROM ${table} WHERE store_id=?`).run(storeId);
  }
  sqlite.prepare("DELETE FROM booths WHERE store_id=?").run(storeId);
  sqlite.prepare("DELETE FROM stores WHERE id=?").run(storeId);
});

describe("直接编辑录入", () => {
  it("预览不写入数据库且正确计算营业利润", () => {
    const preview = previewDirectEntry({ ...baseInput, bankRows: [], counterparties: [] });

    expect(preview.profitCents).toBe(4_000);
    expect(preview.errors).toEqual([]);
  });

  it("拒绝收入和支出同时为零的银行流水", () => {
    const preview = previewDirectEntry({
      ...baseInput,
      bankRows: [{ businessDate: "2026-07-01", summary: "测试", incomeCents: 0, expenseCents: 0 }],
    });
    expect(preview.errors).toContain("第 1 条银行流水收入和支出不能同时为零");
  });

  it("校验金额、必填字段、结算范围和档口收入", () => {
    const preview = previewDirectEntry({
      ...baseInput,
      expenses: [{ category: "", amountCents: -1 }],
      booths: [{ name: "", grossRevenueCents: 9_999, cogsCents: -1 }],
      counterparties: [{ kind: "payable", name: "", originalCents: 100, settledCents: 101 }],
    });
    expect(preview.errors).toContain("第 1 条费用类别不能为空");
    expect(preview.errors).toContain("第 1 条费用金额必须为非负整数");
    expect(preview.errors).toContain("第 1 条档口名称不能为空");
    expect(preview.errors).toContain("档口营业收入合计与营业收入不一致");
    expect(preview.errors).toContain("第 1 条往来单位名称不能为空");
    expect(preview.errors).toContain("第 1 条往来结算金额不能大于原始金额");
  });

  it("确认后在当前门店写入收入费用档口银行和往来", async () => {
    await commitDirectEntry(storeId, "测试财务", baseInput);

    expect(sqlite.prepare("SELECT gross_revenue_cents FROM sales_summaries WHERE store_id=? AND period=?").get(storeId, "2026-07")).toMatchObject({ gross_revenue_cents: 10_000 });
    expect(sqlite.prepare("SELECT amount_cents FROM expense_entries WHERE store_id=? AND period=?").get(storeId, "2026-07")).toMatchObject({ amount_cents: 2_000 });
    expect(sqlite.prepare("SELECT balance_cents FROM bank_transactions WHERE store_id=?").get(storeId)).toMatchObject({ balance_cents: 9_000 });
    expect(sqlite.prepare("SELECT status FROM counterparties WHERE store_id=? AND period=?").get(storeId, "2026-07")).toMatchObject({ status: "partial" });
    expect(sqlite.prepare("SELECT cogs_cents FROM gross_profit_snapshots WHERE store_id=? AND booth_id=? AND period=?").get(storeId, boothId, "2026-07")).toMatchObject({ cogs_cents: 4_000 });
  });

  it("按档口库存公式计算成本并使用营业收入计算毛利", async () => {
    const input: DirectEntryInput = {
      ...baseInput,
      booths: [{
        name: "素菜档",
        grossRevenueCents: 10_000,
        cogsCents: 9_999,
        openingCents: 1_000,
        inboundCents: 6_000,
        outboundCents: 500,
        closingCents: 1_500,
        adjustmentCents: 200,
      }],
    };

    const preview = previewDirectEntry(input);
    expect(preview.cogsCents).toBe(5_200);
    expect(preview.grossProfitCents).toBe(4_800);

    await commitDirectEntry(storeId, "测试财务", input);
    expect(sqlite.prepare("SELECT cogs_cents,gross_profit_cents FROM gross_profit_snapshots WHERE store_id=? AND booth_id=? AND period=?").get(storeId, boothId, "2026-07")).toMatchObject({ cogs_cents: 5_200, gross_profit_cents: 4_800 });
  });

  it("覆盖直接录入后按日期重算当前门店全部银行余额", async () => {
    const now = new Date().toISOString();
    const insert = sqlite.prepare("INSERT INTO bank_transactions (id,store_id,business_date,summary,income_cents,expense_cents,balance_cents,source_batch_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)");
    insert.run("before", storeId, "2026-06-30", "期初", 10_000, 0, 999_999, "seed", now, "test");
    insert.run("after", storeId, "2026-08-15", "后续支出", 0, 2_000, 999_999, "manual", now, "test");

    await commitDirectEntry(storeId, "测试财务", baseInput);
    await commitDirectEntry(storeId, "测试财务", {
      ...baseInput,
      bankRows: [{ businessDate: "2026-07-01", summary: "修正营业入账", incomeCents: 5_000, expenseCents: 0 }],
    });

    const rows = sqlite.prepare("SELECT business_date,balance_cents FROM bank_transactions WHERE store_id=? ORDER BY business_date,created_at,id").all(storeId);
    expect(rows).toEqual([
      { business_date: "2026-06-30", balance_cents: 10_000 },
      { business_date: "2026-07-01", balance_cents: 15_000 },
      { business_date: "2026-08-15", balance_cents: 13_000 },
    ]);
  });

  it("预览提示同账期已有直接录入，确认会覆盖", async () => {
    await commitDirectEntry(storeId, "测试财务", baseInput);

    const preview = previewDirectEntry(baseInput, storeId);
    expect(preview.warnings).toContain("当前门店该账期已有直接录入数据，确认后将覆盖此前直接录入内容");
  });
});
