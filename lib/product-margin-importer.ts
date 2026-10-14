import { createHash, randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { extractDocxTables } from "./docx";
import { ensureSchema, sqlite } from "./db";
import { STORE_ID } from "./db/seed";
import { calculateProductMargin } from "./domain/product-margin";
import { toCents } from "./domain/money";

export type ProductMarginRow = {
  category: string;
  productName: string;
  uom: string;
  sellingPrice: number;
  purchasePrice: number;
  auxiliaryCost: number;
  portionQty: number;
  yieldRate: number;
  freight: number;
  cost: number;
  grossProfit: number;
  grossMargin: number;
  calculationMode: "standard" | "recipe";
  note: string;
};

export type ProductMarginImportPreview = {
  fileName: string;
  fileHash: string;
  sourceType: "excel" | "word";
  period: string;
  duplicate: boolean;
  rows: ProductMarginRow[];
  counterparties: { kind: "payable" | "receivable"; name: string; amount: number; settledAmount: number; dueDate: string; status: "open" | "partial" | "settled"; note: string }[];
  bankRows: { businessDate: string; summary: string; income: number; expense: number }[];
  warnings: string[];
  errors: string[];
};

const value = (input: unknown) => typeof input === "number" && Number.isFinite(input) ? input : Number.parseFloat(String(input ?? "").replace(/[,￥¥%]/g, "")) || 0;
const text = (input: unknown) => String(input ?? "").trim();
const normalized = (input: unknown) => text(input).replace(/[\s　/（）()_-]/g, "").toLowerCase();

function marginRow(input: Omit<ProductMarginRow, "cost" | "grossProfit" | "grossMargin">): ProductMarginRow {
  const result = calculateProductMargin({
    sellingPriceCents: toCents(input.sellingPrice), purchasePriceCents: toCents(input.purchasePrice), auxiliaryCostCents: toCents(input.auxiliaryCost),
    portionQty: input.portionQty, yieldRate: input.yieldRate, freightCents: toCents(input.freight),
  });
  return { ...input, cost: result.costCents / 100, grossProfit: result.grossProfitCents / 100, grossMargin: result.grossMargin };
}

function parseExcel(buffer: Buffer, warnings: string[]) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellFormula: true, cellStyles: false, cellNF: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: false });
  const result: ProductMarginRow[] = [];
  let category = "未分类";
  rows.forEach((row, index) => {
    const first = text(row[0]);
    if (first.endsWith("类") && !["品名", "品 名"].includes(first)) category = first;
    if (!first || typeof row[2] !== "number" || typeof row[3] !== "number" || category === "锅底类") return;
    const actualCategory = first === "自助调料" ? "小料类" : category;
    const standard = marginRow({ category: actualCategory, productName: first, uom: text(row[1]) || "份", sellingPrice: value(row[2]), purchasePrice: value(row[3]), auxiliaryCost: value(row[4]), portionQty: value(row[5]) || 1, yieldRate: value(row[6]) || 1, freight: value(row[8]), calculationMode: "standard", note: text(row[12]) });
    const cachedCost = value(row[9]);
    if (standard.yieldRate > 1) warnings.push(`第 ${index + 1} 行“${first}”净料率为 ${standard.yieldRate}，大于 1，请确认是否实际表示出成系数。`);
    if (cachedCost && Math.abs(cachedCost - standard.cost) > 0.01) warnings.push(`第 ${index + 1} 行“${first}”模板成本 ${cachedCost.toFixed(2)} 元与公式重算 ${standard.cost.toFixed(2)} 元不一致，系统采用重算值。`);
    if (standard.grossProfit < 0) warnings.push(`“${first}”按当前数据为负毛利 ${standard.grossProfit.toFixed(2)} 元。`);
    result.push(standard);
  });

  for (let rowNumber = 192; rowNumber <= 204; rowNumber++) {
    const productName = text(sheet[`J${rowNumber}`]?.v);
    const formula = text(sheet[`L${rowNumber}`]?.f);
    const reference = formula.match(/^=?\$?([A-Z]+)\$?(\d+)$/);
    if (!productName || !reference) continue;
    const target = XLSX.utils.decode_cell(`${reference[1]}${reference[2]}`);
    let sellingPrice = 0; let cost = 0;
    for (let row = target.r; row >= Math.max(0, target.r - 20); row--) {
      const label = text(sheet[XLSX.utils.encode_cell({ r: row, c: target.c - 1 })]?.v);
      const amount = value(sheet[XLSX.utils.encode_cell({ r: row, c: target.c })]?.v);
      if (label === "售价" && !sellingPrice) sellingPrice = amount;
      if (label === "共计" && !cost) cost = amount;
      if (sellingPrice && cost) break;
    }
    if (!sellingPrice) { warnings.push(`锅底“${productName}”没有识别到售价，已跳过。`); continue; }
    const row = marginRow({ category: "锅底类", productName, uom: "锅", sellingPrice, purchasePrice: cost, auxiliaryCost: 0, portionQty: 1, yieldRate: 1, freight: 0, calculationMode: "recipe", note: "由配料成本汇总" });
    if (row.grossProfit < 0) warnings.push(`锅底“${productName}”按配方汇总为负毛利 ${row.grossProfit.toFixed(2)} 元。`);
    result.push(row);
  }
  return result;
}

const findColumn = (headers: string[], aliases: string[]) => headers.findIndex((header) => aliases.some((alias) => header.includes(normalized(alias))));

function parseWord(buffer: Buffer, warnings: string[]) {
  const tables = extractDocxTables(buffer);
  const margins: ProductMarginRow[] = [];
  const counterparties: ProductMarginImportPreview["counterparties"] = [];
  const bankRows: ProductMarginImportPreview["bankRows"] = [];
  for (const table of tables) {
    const headerIndex = table.findIndex((row) => row.some((cell) => normalized(cell).includes("品名") || normalized(cell).includes("商品名称")) || row.some((cell) => ["往来对象", "对象", "名称"].includes(normalized(cell))) || (row.some((cell) => normalized(cell) === "日期") && row.some((cell) => normalized(cell) === "摘要")));
    if (headerIndex < 0) continue;
    const headers = table[headerIndex].map(normalized);
    const productName = findColumn(headers, ["品名", "商品名称"]);
    const sellingPrice = findColumn(headers, ["售价", "售价/份"]);
    if (productName >= 0 && sellingPrice >= 0) {
      const indexes = {
        category: findColumn(headers, ["类别", "分类"]), uom: findColumn(headers, ["单位"]), purchase: findColumn(headers, ["进价", "采购价"]), auxiliary: findColumn(headers, ["辅料", "辅料成本"]),
        portion: findColumn(headers, ["出品分量", "份量"]), yieldRate: findColumn(headers, ["净料率", "出成率"]), freight: findColumn(headers, ["运费", "每份运费"]), note: findColumn(headers, ["备注"]),
      };
      for (const cells of table.slice(headerIndex + 1)) {
        const name = text(cells[productName]);
        if (!name || value(cells[sellingPrice]) <= 0) continue;
        const row = marginRow({ category: indexes.category >= 0 ? text(cells[indexes.category]) || "未分类" : "未分类", productName: name, uom: indexes.uom >= 0 ? text(cells[indexes.uom]) || "份" : "份", sellingPrice: value(cells[sellingPrice]), purchasePrice: indexes.purchase >= 0 ? value(cells[indexes.purchase]) : 0, auxiliaryCost: indexes.auxiliary >= 0 ? value(cells[indexes.auxiliary]) : 0, portionQty: indexes.portion >= 0 ? value(cells[indexes.portion]) || 1 : 1, yieldRate: indexes.yieldRate >= 0 ? value(cells[indexes.yieldRate]) || 1 : 1, freight: indexes.freight >= 0 ? value(cells[indexes.freight]) : 0, calculationMode: "standard", note: indexes.note >= 0 ? text(cells[indexes.note]) : "" });
        if (row.yieldRate > 1) warnings.push(`“${name}”净料率大于 1，请复核。`);
        if (row.grossProfit < 0) warnings.push(`“${name}”按当前数据为负毛利 ${row.grossProfit.toFixed(2)} 元。`);
        margins.push(row);
      }
      continue;
    }

    const partyName = findColumn(headers, ["往来对象", "对象", "名称"]);
    const amount = findColumn(headers, ["金额", "应收金额", "应付金额"]);
    if (partyName >= 0 && amount >= 0) {
      const kind = findColumn(headers, ["类型", "往来类型"]); const settled = findColumn(headers, ["已结金额", "已结"]); const due = findColumn(headers, ["到期日", "到期日期"]); const status = findColumn(headers, ["状态"]); const note = findColumn(headers, ["备注"]);
      for (const cells of table.slice(headerIndex + 1)) {
        const name = text(cells[partyName]); const original = value(cells[amount]); if (!name || original <= 0) continue;
        const statusText = status >= 0 ? text(cells[status]) : ""; const settledAmount = statusText.includes("已结") ? original : settled >= 0 ? Math.min(original, value(cells[settled])) : 0;
        counterparties.push({ kind: kind >= 0 && text(cells[kind]).includes("收") ? "receivable" : "payable", name, amount: original, settledAmount, dueDate: due >= 0 ? text(cells[due]) : "", status: settledAmount >= original ? "settled" : settledAmount > 0 ? "partial" : "open", note: note >= 0 ? text(cells[note]) : "Word导入" });
      }
      continue;
    }

    const date = findColumn(headers, ["日期"]); const summary = findColumn(headers, ["摘要"]); const income = findColumn(headers, ["收入"]); const expense = findColumn(headers, ["支出"]);
    if (date >= 0 && summary >= 0 && (income >= 0 || expense >= 0)) {
      for (const cells of table.slice(headerIndex + 1)) if (text(cells[date]) && text(cells[summary])) bankRows.push({ businessDate: text(cells[date]).replace(/[./]/g, "-"), summary: text(cells[summary]), income: income >= 0 ? value(cells[income]) : 0, expense: expense >= 0 ? value(cells[expense]) : 0 });
    }
  }
  return { margins, counterparties, bankRows };
}

export function parseProductMarginFile(buffer: Buffer, fileName: string, period: string): ProductMarginImportPreview {
  ensureSchema();
  const fileHash = createHash("sha256").update(buffer).digest("hex");
  const duplicate = Boolean(sqlite.prepare("SELECT 1 FROM import_batches WHERE store_id=? AND file_hash=?").get(STORE_ID, fileHash));
  const warnings: string[] = []; const errors: string[] = [];
  const isWord = fileName.toLowerCase().endsWith(".docx");
  let rows: ProductMarginRow[] = []; let counterparties: ProductMarginImportPreview["counterparties"] = []; let bankRows: ProductMarginImportPreview["bankRows"] = [];
  try {
    if (isWord) ({ margins: rows, counterparties, bankRows } = parseWord(buffer, warnings));
    else rows = parseExcel(buffer, warnings);
  } catch (error) { errors.push(error instanceof Error ? error.message : "文件解析失败"); }
  if (!rows.length && !counterparties.length && !bankRows.length) errors.push("没有识别到单品毛利、资金往来或银行流水表格");
  if (duplicate) warnings.unshift("该文件已经导入，重复提交不会再次写入。");
  return { fileName, fileHash, sourceType: isWord ? "word" : "excel", period, duplicate, rows, counterparties, bankRows, warnings, errors };
}

export function commitProductMarginImport(preview: ProductMarginImportPreview, actor: string) {
  ensureSchema();
  const prior = sqlite.prepare("SELECT id FROM import_batches WHERE store_id=? AND file_hash=?").get(STORE_ID, preview.fileHash) as { id: string } | undefined;
  if (prior) return { batchId: prior.id, duplicate: true };
  if (preview.errors.length) throw new Error(preview.errors.join("；"));
  const batchId = randomUUID(); const now = new Date().toISOString();
  sqlite.transaction(() => {
    sqlite.prepare("INSERT INTO import_batches (id,store_id,file_name,file_hash,status,sheet_count,error_count,summary_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)").run(batchId, STORE_ID, preview.fileName, preview.fileHash, "committed", 1, 0, JSON.stringify({ type: "product_margin", rows: preview.rows.length, counterparties: preview.counterparties.length, bankRows: preview.bankRows.length }), now, actor);
    const product = sqlite.prepare(`INSERT INTO product_margins (id,store_id,period,category,product_name,uom,selling_price_cents,purchase_price_cents,auxiliary_cost_cents,portion_qty,yield_rate,freight_cents,cost_cents,gross_profit_cents,gross_margin,calculation_mode,source_type,source_batch_id,note,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(store_id,period,category,product_name) DO UPDATE SET uom=excluded.uom,selling_price_cents=excluded.selling_price_cents,purchase_price_cents=excluded.purchase_price_cents,auxiliary_cost_cents=excluded.auxiliary_cost_cents,portion_qty=excluded.portion_qty,yield_rate=excluded.yield_rate,freight_cents=excluded.freight_cents,cost_cents=excluded.cost_cents,gross_profit_cents=excluded.gross_profit_cents,gross_margin=excluded.gross_margin,calculation_mode=excluded.calculation_mode,source_type=excluded.source_type,source_batch_id=excluded.source_batch_id,note=excluded.note`);
    for (const row of preview.rows) product.run(randomUUID(), STORE_ID, preview.period, row.category, row.productName, row.uom, toCents(row.sellingPrice), toCents(row.purchasePrice), toCents(row.auxiliaryCost), row.portionQty, row.yieldRate, toCents(row.freight), toCents(row.cost), toCents(row.grossProfit), row.grossMargin, row.calculationMode, preview.sourceType, batchId, row.note, now, actor);
    const party = sqlite.prepare("INSERT INTO counterparties (id,store_id,kind,period,name,original_cents,settled_cents,due_date,status,note,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const row of preview.counterparties) party.run(randomUUID(), STORE_ID, row.kind, preview.period, row.name, toCents(row.amount), toCents(row.settledAmount), row.dueDate || null, row.status, row.note, now, actor);
    let balance = (sqlite.prepare("SELECT balance_cents FROM bank_transactions WHERE store_id=? ORDER BY business_date DESC,created_at DESC LIMIT 1").get(STORE_ID) as { balance_cents: number } | undefined)?.balance_cents ?? 0;
    const bank = sqlite.prepare("INSERT INTO bank_transactions (id,store_id,business_date,summary,income_cents,expense_cents,balance_cents,source_batch_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)");
    for (const row of preview.bankRows) { balance += toCents(row.income) - toCents(row.expense); bank.run(randomUUID(), STORE_ID, row.businessDate, row.summary, toCents(row.income), toCents(row.expense), balance, batchId, now, actor); }
    sqlite.prepare("INSERT INTO audit_logs (id,store_id,action,entity_type,entity_id,payload_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)").run(randomUUID(), STORE_ID, `${preview.sourceType}_structured_import`, "import_batch", batchId, JSON.stringify({ fileName: preview.fileName, rows: preview.rows.length }), now, actor);
  })();
  return { batchId, duplicate: false };
}
