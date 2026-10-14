import { createHash, randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { sqlite, ensureSchema } from "./db";
import { STORE_ID } from "./db/seed";
import { toCents } from "./domain/money";

type Cell = string | number | boolean | Date | null;
type Row = Cell[];

export type GrossRow = {
  booth: string;
  grossRevenue: number;
  netRevenue: number;
  discount: number;
  opening: number;
  inbound: number;
  outbound: number;
  closing: number;
  cogs: number;
  grossProfit: number;
};

export type ImportPreview = {
  fileName: string;
  fileHash: string;
  duplicate: boolean;
  sheets: { name: string; detectedRows: number; status: "recognized" | "ignored" }[];
  summary: {
    period: string;
    grossRevenue: number;
    netRevenue: number;
    discount: number;
    orderCount: number;
    cogs: number;
    grossProfit: number;
    operatingProfit: number;
    bankBalance: number;
    payable: number;
    receivable: number;
    consumableRows: number;
  };
  grossRows: GrossRow[];
  expenses: { category: string; amount: number }[];
  bankRows: { date: string; summary: string; income: number; expense: number; balance: number }[];
  payables: { name: string; amount: number }[];
  receivables: { name: string; amount: number }[];
  warnings: string[];
  errors: string[];
};

const num = (value: Cell) => typeof value === "number" && Number.isFinite(value) ? value : Number.parseFloat(String(value ?? "")) || 0;
const text = (value: Cell) => String(value ?? "").trim();

function rowsOf(workbook: XLSX.WorkBook, name: string): Row[] {
  const sheet = workbook.Sheets[name];
  return sheet ? XLSX.utils.sheet_to_json<Row>(sheet, { header: 1, raw: true, defval: null, blankrows: false }) : [];
}

function findSheet(names: string[], token: string) {
  return names.find((name) => name.includes(token));
}

export function parseWorkbook(buffer: Buffer, fileName: string): ImportPreview {
  ensureSchema();
  const fileHash = createHash("sha256").update(buffer).digest("hex");
  const duplicate = Boolean(sqlite.prepare("SELECT 1 FROM import_batches WHERE store_id = ? AND file_hash = ?").get(STORE_ID, fileHash));
  const workbook = XLSX.read(buffer, { type: "buffer", sheetRows: 500, cellFormula: false, cellStyles: false, cellNF: false });
  const names = workbook.SheetNames;
  const recognizedTokens = ["目录", "经营分析", "毛利分析", "营业收入概览", "低值易耗", "银行收支", "应付账款", "应收账款"];
  const sheetInfo = names.map((name) => {
    const rows = rowsOf(workbook, name);
    return { name, detectedRows: rows.filter((row) => row.some((cell) => cell !== null && cell !== "")).length, status: (recognizedTokens.some((token) => name.includes(token)) ? "recognized" : "ignored") as "recognized" | "ignored" };
  });

  const mainName = findSheet(names, "经营分析");
  const grossName = findSheet(names, "毛利分析");
  const incomeName = findSheet(names, "营业收入概览");
  const bankName = findSheet(names, "银行收支");
  const payableName = findSheet(names, "应付账款");
  const receivableName = findSheet(names, "应收账款");
  const consumableName = findSheet(names, "低值易耗");
  const errors: string[] = [];
  for (const [label, value] of [["经营分析", mainName], ["毛利分析", grossName], ["营业收入概览", incomeName], ["银行收支", bankName], ["应付账款", payableName], ["应收账款", receivableName]] as const) {
    if (!value) errors.push(`缺少${label}工作表`);
  }

  const main = mainName ? rowsOf(workbook, mainName) : [];
  const mainByName = new Map(main.map((row) => [text(row[2]), num(row[20])]));
  const gross = grossName ? rowsOf(workbook, grossName) : [];
  const grossHeader = gross.findIndex((row) => text(row[0]) === "分类");
  const grossRows: GrossRow[] = gross.slice(Math.max(0, grossHeader + 1)).filter((row) => text(row[0]) && text(row[0]) !== "合计").slice(0, 7).map((row) => ({
    booth: text(row[0]), grossRevenue: num(row[1]), netRevenue: num(row[2]), discount: num(row[3]),
    opening: num(row[4]), inbound: num(row[5]), outbound: num(row[6]), closing: num(row[8]),
    cogs: num(row[9]), grossProfit: num(row[10]),
  }));
  const income = incomeName ? rowsOf(workbook, incomeName) : [];
  const findIncome = (label: string) => num(income.find((row) => text(row[0]) === label)?.[1] ?? 0);
  const grossRevenue = mainByName.get("主营业务收入") || findIncome("营业额");
  const netRevenue = findIncome("营业收入");
  const discount = findIncome("优惠金额");
  const orderCount = findIncome("订单量");
  const cogs = mainByName.get("主营业务成本") || grossRows.reduce((sum, row) => sum + row.cogs, 0);
  const grossProfit = mainByName.get("经营毛利(率)") || grossRevenue - cogs;
  const operatingProfit = mainByName.get("营业利润") || 0;

  const expenseLabels = ["固定成本", "人工成本", "能源成本", "管理成本", "营销成本", "财务成本", "税金"];
  const expenses = expenseLabels.map((category) => ({ category, amount: mainByName.get(category) ?? 0 }));
  const bank = bankName ? rowsOf(workbook, bankName) : [];
  const bankHeader = bank.findIndex((row) => text(row[1]) === "日期" && text(row[2]) === "摘要");
  const bankRows = bank.slice(Math.max(0, bankHeader + 1)).filter((row) => text(row[1]) && text(row[2])).map((row) => ({ date: text(row[1]), summary: text(row[2]), income: num(row[3]), expense: num(row[4]), balance: num(row[5]) }));
  const bankBalance = bankRows.at(-1)?.balance ?? 0;
  const payableRows = payableName ? rowsOf(workbook, payableName) : [];
  const payableHeader = payableRows.findIndex((row) => row.some((cell) => text(cell) === "名称"));
  const payables = payableRows.slice(Math.max(0, payableHeader + 1)).filter((row) => text(row[2]) && text(row[2]) !== "名称" && text(row[1]) !== "合计").map((row) => ({ name: text(row[2]), amount: num(row[3]) })).filter((row) => row.amount > 0);
  const receivableRows = receivableName ? rowsOf(workbook, receivableName) : [];
  const receivableHeader = receivableRows.findIndex((row) => text(row[0]) === "序号" && text(row[1]) === "用途");
  const receivables = receivableRows.slice(Math.max(0, receivableHeader + 1)).filter((row) => text(row[1]) && !text(row[1]).includes("合计")).map((row) => ({ name: text(row[1]).replace(/^应收账款-/, ""), amount: num(row[2]) })).filter((row) => row.amount > 0);
  const consumables = consumableName ? rowsOf(workbook, consumableName) : [];
  const consumableHeader = consumables.findIndex((row) => text(row[0]) === "物品编码");
  const consumableRows = consumables.slice(Math.max(0, consumableHeader + 1)).filter((row) => text(row[0]) && text(row[0]) !== "物品编码").length;
  const payable = Math.round(payables.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;
  const receivable = Math.round(receivables.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;
  const warnings: string[] = [];
  if (duplicate) warnings.push("该文件已导入，提交按钮将保持幂等，不会重复写入。");
  if (consumableName) warnings.push("低值易耗表采用最多500行的稀疏读取，已忽略异常格式化空白区域。");
  if (Math.abs(grossRevenue - grossRows.reduce((sum, row) => sum + row.grossRevenue, 0)) > 0.01) warnings.push("经营表与档口毛利表的营业额存在差异，请复核。");
  if (Math.abs(cogs - grossRows.reduce((sum, row) => sum + row.cogs, 0)) > 0.01) warnings.push("经营表与档口毛利表的成本存在差异，请复核。");

  return {
    fileName, fileHash, duplicate, sheets: sheetInfo,
    summary: { period: "2026-06", grossRevenue, netRevenue, discount, orderCount, cogs, grossProfit, operatingProfit, bankBalance, payable, receivable, consumableRows },
    grossRows, expenses, bankRows, payables, receivables, warnings, errors,
  };
}

export function commitImport(preview: ImportPreview, actor = "财务") {
  ensureSchema();
  const prior = sqlite.prepare("SELECT id FROM import_batches WHERE store_id = ? AND file_hash = ?").get(STORE_ID, preview.fileHash) as { id: string } | undefined;
  if (prior) return { batchId: prior.id, duplicate: true };
  if (preview.errors.length) throw new Error(preview.errors.join("；"));
  const batchId = randomUUID();
  const now = new Date().toISOString();
  const tx = sqlite.transaction(() => {
    sqlite.prepare("INSERT INTO import_batches (id,store_id,file_name,file_hash,status,sheet_count,error_count,summary_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(batchId, STORE_ID, preview.fileName, preview.fileHash, "committed", preview.sheets.length, 0, JSON.stringify(preview.summary), now, actor);
    sqlite.prepare(`INSERT INTO sales_summaries (id,store_id,period,gross_revenue_cents,net_revenue_cents,discount_cents,order_count,source_batch_id,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(store_id,period) DO UPDATE SET gross_revenue_cents=excluded.gross_revenue_cents,net_revenue_cents=excluded.net_revenue_cents,discount_cents=excluded.discount_cents,order_count=excluded.order_count,source_batch_id=excluded.source_batch_id`)
      .run(`sales-${preview.summary.period}`, STORE_ID, preview.summary.period, toCents(preview.summary.grossRevenue), toCents(preview.summary.netRevenue), toCents(preview.summary.discount), preview.summary.orderCount, batchId, now, actor);
    sqlite.prepare("DELETE FROM gross_profit_snapshots WHERE store_id=? AND period=?").run(STORE_ID, preview.summary.period);
    const boothLookup = sqlite.prepare("SELECT id FROM booths WHERE store_id=? AND name LIKE ?");
    const grossInsert = sqlite.prepare("INSERT INTO gross_profit_snapshots (id,store_id,booth_id,period,gross_revenue_cents,net_revenue_cents,discount_cents,opening_cents,inbound_cents,outbound_cents,closing_cents,cogs_cents,gross_profit_cents,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const row of preview.grossRows) {
      const key = row.booth.includes("荤菜") ? "%荤菜%" : row.booth.includes("明档") ? "%明档%" : row.booth.includes("小料") ? "%小料%" : `%${row.booth.replace(/档.*/, "")}%`;
      const booth = boothLookup.get(STORE_ID, key) as { id: string } | undefined;
      if (booth) grossInsert.run(randomUUID(), STORE_ID, booth.id, preview.summary.period, toCents(row.grossRevenue), toCents(row.netRevenue), toCents(row.discount), toCents(row.opening), toCents(row.inbound), toCents(row.outbound), toCents(row.closing), toCents(row.cogs), toCents(row.grossProfit), now, actor);
    }
    sqlite.prepare("DELETE FROM expense_entries WHERE store_id=? AND period=?").run(STORE_ID, preview.summary.period);
    const expenseInsert = sqlite.prepare("INSERT INTO expense_entries (id,store_id,period,category,amount_cents,note,source_batch_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)");
    for (const row of preview.expenses) expenseInsert.run(randomUUID(), STORE_ID, preview.summary.period, row.category, toCents(row.amount), "Excel导入", batchId, now, actor);
    sqlite.prepare("DELETE FROM bank_transactions WHERE store_id=? AND source_batch_id IN ('seed-june',?)").run(STORE_ID, batchId);
    const bankInsert = sqlite.prepare("INSERT INTO bank_transactions (id,store_id,business_date,summary,income_cents,expense_cents,balance_cents,source_batch_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)");
    for (const row of preview.bankRows) bankInsert.run(randomUUID(), STORE_ID, row.date.replace(/\./g, "-"), row.summary, toCents(row.income), toCents(row.expense), toCents(row.balance), batchId, now, actor);
    sqlite.prepare("DELETE FROM counterparties WHERE store_id=?").run(STORE_ID);
    const partyInsert = sqlite.prepare("INSERT INTO counterparties (id,store_id,kind,name,original_cents,settled_cents,due_date,status,note,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    for (const row of preview.payables) partyInsert.run(randomUUID(), STORE_ID, "payable", row.name, toCents(row.amount), 0, "2026-07-15", "open", "Excel导入", now, actor);
    for (const row of preview.receivables) partyInsert.run(randomUUID(), STORE_ID, "receivable", row.name, toCents(row.amount), 0, "2026-07-15", "open", "Excel导入", now, actor);
    sqlite.prepare("INSERT INTO audit_logs (id,store_id,action,entity_type,entity_id,payload_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)")
      .run(randomUUID(), STORE_ID, "excel_import", "import_batch", batchId, JSON.stringify({ fileName: preview.fileName, hash: preview.fileHash }), now, actor);
  });
  tx();
  return { batchId, duplicate: false };
}
