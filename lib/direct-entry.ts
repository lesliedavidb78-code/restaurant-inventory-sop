import { randomUUID } from "node:crypto";
import { ready } from "./services";
import { sqlite } from "./db";

export type DirectEntryInput = {
  period: string;
  sales: {
    grossRevenueCents: number;
    netRevenueCents: number;
    discountCents: number;
    orderCount: number;
  };
  expenses: Array<{ category: string; amountCents: number; note?: string }>;
  booths: Array<{
    name: string;
    grossRevenueCents: number;
    cogsCents: number;
    netRevenueCents?: number;
    discountCents?: number;
    openingCents?: number;
    inboundCents?: number;
    outboundCents?: number;
    closingCents?: number;
    adjustmentCents?: number;
  }>;
  bankRows: Array<{ businessDate: string; summary: string; incomeCents: number; expenseCents: number }>;
  counterparties: Array<{ kind: "receivable" | "payable"; name: string; originalCents: number; settledCents?: number; dueDate?: string; note?: string }>;
};

export type DirectEntryPreview = {
  revenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  expenseCents: number;
  profitCents: number;
  bankBalanceCents: number;
  receivableCents: number;
  payableCents: number;
  errors: string[];
  warnings: string[];
};

const isNonNegativeInteger = (value: number) => Number.isInteger(value) && value >= 0;
const isInteger = (value: number) => Number.isInteger(value);

function validateInput(input: DirectEntryInput) {
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}$/.test(input.period)) errors.push("账期格式必须为 YYYY-MM");

  for (const [label, value] of [["营业收入", input.sales.grossRevenueCents], ["实收收入", input.sales.netRevenueCents], ["优惠金额", input.sales.discountCents], ["订单量", input.sales.orderCount]] as const) {
    if (!isNonNegativeInteger(value)) errors.push(`${label}必须为非负整数`);
  }

  input.expenses.forEach((row, index) => {
    if (!row.category.trim()) errors.push(`第 ${index + 1} 条费用类别不能为空`);
    if (!isNonNegativeInteger(row.amountCents)) errors.push(`第 ${index + 1} 条费用金额必须为非负整数`);
  });

  input.booths.forEach((row, index) => {
    if (!row.name.trim()) errors.push(`第 ${index + 1} 条档口名称不能为空`);
    for (const value of [row.grossRevenueCents, row.cogsCents, row.netRevenueCents ?? row.grossRevenueCents, row.discountCents ?? 0, row.openingCents ?? 0, row.inboundCents ?? 0, row.outboundCents ?? 0, row.closingCents ?? 0]) {
      if (!isNonNegativeInteger(value)) {
        errors.push(`第 ${index + 1} 条档口金额必须为非负整数`);
        break;
      }
    }
    if (row.adjustmentCents !== undefined && !isInteger(row.adjustmentCents)) {
      errors.push(`第 ${index + 1} 条档口调整金额必须为整数`);
    }
  });

  if (input.booths.reduce((sum, row) => sum + row.grossRevenueCents, 0) !== input.sales.grossRevenueCents) {
    errors.push("档口营业收入合计与营业收入不一致");
  }

  input.bankRows.forEach((row, index) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.businessDate)) errors.push(`第 ${index + 1} 条银行流水日期格式不正确`);
    if (!row.summary.trim()) errors.push(`第 ${index + 1} 条银行流水摘要不能为空`);
    if (!isNonNegativeInteger(row.incomeCents) || !isNonNegativeInteger(row.expenseCents)) errors.push(`第 ${index + 1} 条银行流水金额必须为非负整数`);
    if (row.incomeCents === 0 && row.expenseCents === 0) errors.push(`第 ${index + 1} 条银行流水收入和支出不能同时为零`);
  });

  input.counterparties.forEach((row, index) => {
    const settledCents = row.settledCents ?? 0;
    if (!row.name.trim()) errors.push(`第 ${index + 1} 条往来单位名称不能为空`);
    if (!isNonNegativeInteger(row.originalCents) || !isNonNegativeInteger(settledCents)) errors.push(`第 ${index + 1} 条往来金额必须为非负整数`);
    if (settledCents > row.originalCents) errors.push(`第 ${index + 1} 条往来结算金额不能大于原始金额`);
  });
  return errors;
}

function calculateBoothCogs(row: DirectEntryInput["booths"][number]) {
  const hasInventoryValues = [row.openingCents, row.inboundCents, row.outboundCents, row.closingCents, row.adjustmentCents]
    .some((value) => value !== undefined);
  if (!hasInventoryValues) return row.cogsCents;
  return (row.openingCents ?? 0) + (row.inboundCents ?? 0) - (row.outboundCents ?? 0) - (row.closingCents ?? 0) + (row.adjustmentCents ?? 0);
}

type DirectEntryAudit = { snapshotIds?: string[] };

function monthRange(period: string) {
  const [year, month] = period.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return { from: `${period}-01`, to: next.toISOString().slice(0, 10) };
}

function latestDirectEntryAudit(storeId: string, period: string): DirectEntryAudit {
  const row = sqlite.prepare("SELECT payload_json FROM audit_logs WHERE store_id=? AND action='commit_direct_entry' AND entity_type='period' AND entity_id=? ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(storeId, period) as { payload_json: string } | undefined;
  if (!row) return {};
  try {
    return JSON.parse(row.payload_json) as DirectEntryAudit;
  } catch {
    return {};
  }
}

function existingEntryState(storeId: string, period: string) {
  const sourceBatchId = `direct-entry:${period}`;
  const errors: string[] = [];
  let hasDirectEntry = false;
  const nonDirect = (count: number, label: string) => {
    if (count > 0) errors.push(`该门店该账期已有非直接录入的${label}，请使用相应来源或调整单修正，不能直接覆盖`);
  };

  const sales = sqlite.prepare("SELECT source_batch_id FROM sales_summaries WHERE store_id=? AND period=?").get(storeId, period) as { source_batch_id: string | null } | undefined;
  if (sales) {
    if (sales.source_batch_id === sourceBatchId) hasDirectEntry = true;
    else nonDirect(1, "营业收入");
  }

  const expenses = sqlite.prepare("SELECT source_batch_id FROM expense_entries WHERE store_id=? AND period=?").all(storeId, period) as { source_batch_id: string | null }[];
  if (expenses.some((row) => row.source_batch_id === sourceBatchId)) hasDirectEntry = true;
  nonDirect(expenses.filter((row) => row.source_batch_id !== sourceBatchId).length, "费用");

  const counterparties = sqlite.prepare("SELECT note FROM counterparties WHERE store_id=? AND period=?").all(storeId, period) as { note: string | null }[];
  const directCounterpartyPrefix = `[直接录入:${period}]`;
  if (counterparties.some((row) => row.note?.startsWith(directCounterpartyPrefix))) hasDirectEntry = true;
  nonDirect(counterparties.filter((row) => !row.note?.startsWith(directCounterpartyPrefix)).length, "应收应付");

  const { from, to } = monthRange(period);
  const bankRows = sqlite.prepare("SELECT source_batch_id FROM bank_transactions WHERE store_id=? AND business_date>=? AND business_date<?").all(storeId, from, to) as { source_batch_id: string | null }[];
  if (bankRows.some((row) => row.source_batch_id === sourceBatchId)) hasDirectEntry = true;
  nonDirect(bankRows.filter((row) => row.source_batch_id !== sourceBatchId).length, "银行流水");

  const snapshots = sqlite.prepare("SELECT id FROM gross_profit_snapshots WHERE store_id=? AND period=?").all(storeId, period) as { id: string }[];
  const directSnapshotIds = new Set(latestDirectEntryAudit(storeId, period).snapshotIds ?? []);
  if (snapshots.some((row) => directSnapshotIds.has(row.id))) hasDirectEntry = true;
  nonDirect(snapshots.filter((row) => !directSnapshotIds.has(row.id)).length, "档口毛利");

  return { errors, hasDirectEntry, directSnapshotIds: [...directSnapshotIds] };
}

function previewBankBalance(storeId: string, input: DirectEntryInput) {
  const sourceBatchId = `direct-entry:${input.period}`;
  const existingRows = sqlite.prepare("SELECT business_date,created_at,id,income_cents,expense_cents FROM bank_transactions WHERE store_id=? AND COALESCE(source_batch_id,'')<>?")
    .all(storeId, sourceBatchId) as Array<{ business_date: string; created_at: string; id: string; income_cents: number; expense_cents: number }>;
  const draftRows = input.bankRows.map((row, index) => ({
    business_date: row.businessDate,
    created_at: "",
    id: `draft-${index}`,
    income_cents: row.incomeCents,
    expense_cents: row.expenseCents,
  }));
  return [...existingRows, ...draftRows]
    .sort((a, b) => a.business_date.localeCompare(b.business_date) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .reduce((balance, row) => balance + row.income_cents - row.expense_cents, 0);
}

export function previewDirectEntry(input: DirectEntryInput, storeId?: string): DirectEntryPreview {
  const state = storeId ? existingEntryState(storeId, input.period) : undefined;
  const cogsCents = input.booths.reduce((sum, row) => sum + calculateBoothCogs(row), 0);
  const expenseCents = input.expenses.reduce((sum, row) => sum + row.amountCents, 0);
  const grossProfitCents = input.sales.grossRevenueCents - cogsCents;
  return {
    revenueCents: input.sales.grossRevenueCents,
    cogsCents,
    grossProfitCents,
    expenseCents,
    profitCents: grossProfitCents - expenseCents,
    bankBalanceCents: storeId ? previewBankBalance(storeId, input) : input.bankRows.reduce((sum, row) => sum + row.incomeCents - row.expenseCents, 0),
    receivableCents: input.counterparties.filter((row) => row.kind === "receivable").reduce((sum, row) => sum + row.originalCents - (row.settledCents ?? 0), 0),
    payableCents: input.counterparties.filter((row) => row.kind === "payable").reduce((sum, row) => sum + row.originalCents - (row.settledCents ?? 0), 0),
    errors: [...validateInput(input), ...(state?.errors ?? [])],
    warnings: state?.hasDirectEntry ? ["当前门店该账期已有直接录入数据，确认后将覆盖此前直接录入内容"] : [],
  };
}

export async function commitDirectEntry(storeId: string, actor: string, input: DirectEntryInput) {
  await ready();
  const preview = previewDirectEntry(input, storeId);
  if (preview.errors.length) throw new Error(preview.errors.join("；"));

  const now = new Date().toISOString();
  const sourceBatchId = `direct-entry:${input.period}`;
  const commit = sqlite.transaction(() => {
    const closed = sqlite.prepare("SELECT status FROM period_closes WHERE store_id=? AND period=?").get(storeId, input.period) as { status: string } | undefined;
    if (closed?.status === "closed") throw new Error("该月份已经月结，不能直接录入");

    const state = existingEntryState(storeId, input.period);
    if (state.errors.length) throw new Error(state.errors.join("；"));
    const boothRows = input.booths.map((row) => {
      const booth = sqlite.prepare("SELECT id FROM booths WHERE store_id=? AND name=?").get(storeId, row.name.trim()) as { id: string } | undefined;
      if (!booth) throw new Error(`档口不存在：${row.name}`);
      return { ...row, boothId: booth.id };
    });

    sqlite.prepare("DELETE FROM sales_summaries WHERE store_id=? AND period=? AND source_batch_id=?").run(storeId, input.period, sourceBatchId);
    sqlite.prepare("INSERT INTO sales_summaries (id,store_id,period,gross_revenue_cents,net_revenue_cents,discount_cents,order_count,source_batch_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(randomUUID(), storeId, input.period, input.sales.grossRevenueCents, input.sales.netRevenueCents, input.sales.discountCents, input.sales.orderCount, sourceBatchId, now, actor);

    sqlite.prepare("DELETE FROM expense_entries WHERE store_id=? AND period=? AND source_batch_id=?").run(storeId, input.period, sourceBatchId);
    const insertExpense = sqlite.prepare("INSERT INTO expense_entries (id,store_id,period,category,amount_cents,note,source_batch_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)");
    input.expenses.forEach((row) => insertExpense.run(randomUUID(), storeId, input.period, row.category.trim(), row.amountCents, row.note ?? null, sourceBatchId, now, actor));

    if (state.directSnapshotIds.length) {
      const placeholders = state.directSnapshotIds.map(() => "?").join(",");
      sqlite.prepare(`DELETE FROM gross_profit_snapshots WHERE store_id=? AND id IN (${placeholders})`).run(storeId, ...state.directSnapshotIds);
    }
    const insertSnapshot = sqlite.prepare("INSERT INTO gross_profit_snapshots (id,store_id,booth_id,period,gross_revenue_cents,net_revenue_cents,discount_cents,opening_cents,inbound_cents,outbound_cents,closing_cents,cogs_cents,gross_profit_cents,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const snapshotIds: string[] = [];
    boothRows.forEach((row) => {
      const cogsCents = calculateBoothCogs(row);
      const snapshotId = randomUUID();
      snapshotIds.push(snapshotId);
      insertSnapshot.run(snapshotId, storeId, row.boothId, input.period, row.grossRevenueCents, row.netRevenueCents ?? row.grossRevenueCents, row.discountCents ?? 0, row.openingCents ?? 0, row.inboundCents ?? 0, row.outboundCents ?? 0, row.closingCents ?? 0, cogsCents, row.grossRevenueCents - cogsCents, now, actor);
    });

    sqlite.prepare("DELETE FROM bank_transactions WHERE store_id=? AND source_batch_id=?").run(storeId, sourceBatchId);
    const bankRows = [...input.bankRows].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
    const insertBank = sqlite.prepare("INSERT INTO bank_transactions (id,store_id,business_date,summary,income_cents,expense_cents,balance_cents,source_batch_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)");
    bankRows.forEach((row) => insertBank.run(randomUUID(), storeId, row.businessDate, row.summary.trim(), row.incomeCents, row.expenseCents, 0, sourceBatchId, now, actor));

    let balanceCents = 0;
    const allBankRows = sqlite.prepare("SELECT id,income_cents,expense_cents FROM bank_transactions WHERE store_id=? ORDER BY business_date ASC,created_at ASC,id ASC").all(storeId) as { id: string; income_cents: number; expense_cents: number }[];
    const updateBalance = sqlite.prepare("UPDATE bank_transactions SET balance_cents=? WHERE id=?");
    allBankRows.forEach((row) => {
      balanceCents += row.income_cents - row.expense_cents;
      updateBalance.run(balanceCents, row.id);
    });

    const directCounterpartyPrefix = `[直接录入:${input.period}]`;
    sqlite.prepare("DELETE FROM counterparties WHERE store_id=? AND period=? AND note LIKE ?").run(storeId, input.period, `${directCounterpartyPrefix}%`);
    const insertCounterparty = sqlite.prepare("INSERT INTO counterparties (id,store_id,kind,period,name,original_cents,settled_cents,due_date,status,note,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    input.counterparties.forEach((row) => {
      const settledCents = row.settledCents ?? 0;
      const status = settledCents === 0 ? "unsettled" : settledCents === row.originalCents ? "settled" : "partial";
      const note = `${directCounterpartyPrefix}${row.note ? ` ${row.note}` : ""}`;
      insertCounterparty.run(randomUUID(), storeId, row.kind, input.period, row.name.trim(), row.originalCents, settledCents, row.dueDate ?? null, status, note, now, actor);
    });

    sqlite.prepare("INSERT INTO audit_logs (id,store_id,action,entity_type,entity_id,payload_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)")
      .run(randomUUID(), storeId, "commit_direct_entry", "period", input.period, JSON.stringify({ period: input.period, sourceBatchId, snapshotIds }), now, actor);
    return { bankBalanceCents: balanceCents };
  });

  return { ...preview, ...commit(), sourceBatchId };
}
