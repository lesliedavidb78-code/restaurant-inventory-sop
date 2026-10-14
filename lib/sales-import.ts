import { createHash } from "node:crypto";
import { businessDate } from "@/lib/domain/business-date";
import * as XLSX from "xlsx";

export type SalesImportLine = { row: number; salesSku: string; dishName: string; quantity: number };
export type SalesImportPreview = {
  fileName: string; fileHash: string; businessDate: string; sheetName: string;
  lines: SalesImportLine[]; warnings: string[]; errors: string[];
};

const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => typeof value === "number" ? value : Number(text(value).replace(/,/g, ""));
const labels = {
  name: ["菜品名称", "商品名称", "品名", "商品", "菜名"],
  sku: ["菜品SKU", "商品SKU", "菜品编码", "商品编码", "SKU", "编码"],
  quantity: ["销售数量", "销量", "数量", "份数", "销售份数"],
};

function findHeader(rows: unknown[][], candidates: string[]) {
  for (let row = 0; row < Math.min(rows.length, 20); row += 1) {
    const col = rows[row].findIndex((cell) => candidates.includes(text(cell)));
    if (col >= 0) return { row, col };
  }
  return null;
}

function inferDate(fileName: string, rows: unknown[][]) {
  const raw = `${fileName} ${rows.slice(0, 8).flat().map(text).join(" ")}`;
  const full = raw.match(/(20\d{2})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/);
  if (full) return `${full[1]}-${full[2].padStart(2, "0")}-${full[3].padStart(2, "0")}`;
  return businessDate();
}

/** 识别美团销量明细最常见的“菜品名称 + 销售数量”，SKU 为可选列。 */
export function parseSalesWorkbook(buffer: Buffer, fileName: string): SalesImportPreview {
  const workbook = XLSX.read(buffer, { cellFormula: false, cellStyles: false });
  const preview: SalesImportPreview = { fileName, fileHash: createHash("sha256").update(buffer).digest("hex"), businessDate: businessDate(), sheetName: "", lines: [], warnings: [], errors: [] };
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", blankrows: false });
    const name = findHeader(rows, labels.name);
    const quantity = findHeader(rows, labels.quantity);
    if (!name || !quantity) continue;
    const sku = findHeader(rows, labels.sku);
    const headerRow = Math.max(name.row, quantity.row, sku?.row ?? 0);
    const lines = rows.slice(headerRow + 1).flatMap((row, index) => {
      const dishName = text(row[name.col]);
      const qty = number(row[quantity.col]);
      if (!dishName || /^(合计|总计|小计|备注)$/u.test(dishName) || !Number.isFinite(qty) || qty <= 0) return [];
      return [{ row: headerRow + index + 2, salesSku: sku ? text(row[sku.col]) : "", dishName, quantity: qty }];
    });
    if (lines.length) {
      preview.sheetName = sheetName;
      preview.lines = lines;
      preview.businessDate = inferDate(fileName, rows);
      if (!sku) preview.warnings.push("未找到销售 SKU 列，将按菜品名称匹配；相似菜名会列为待确认，不会自动计入理论耗用。");
      break;
    }
  }
  if (!preview.lines.length) preview.errors.push("未识别到销量明细。请确认 Excel 至少包含“菜品名称”和“销售数量/销量”列。");
  return preview;
}
