import * as XLSX from "xlsx";

export type CountImportItem = { itemId: string; sku: string; itemName: string };
export type StockCountImportLine = { row: number; itemId: string; itemName: string; countedQuantity: number; reason: string; matchedBy: "SKU" | "商品名称" };
export type StockCountImportPreview = { fileName: string; validLines: StockCountImportLine[]; errors: string[]; warnings: string[] };

const text = (value: unknown) => String(value ?? "").trim();
const normalized = (value: string) => value.replace(/\s+/g, "").toLowerCase();

function headerIndex(headers: unknown[], names: string[]) {
  return headers.findIndex((header) => names.includes(text(header)));
}

/** Parse the downloadable stock-count sheet. Data is previewed before any draft is changed. */
export function parseStockCountWorkbook(buffer: Buffer, fileName: string, items: CountImportItem[]): StockCountImportPreview {
  const book = XLSX.read(buffer, { cellFormula: false, cellStyles: false });
  const sheetName = book.SheetNames[0];
  if (!sheetName) throw new Error("Excel 中没有可读取的工作表。");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheetName], { header: 1, defval: "", blankrows: true });
  if (!rows.length) throw new Error("Excel 为空，请使用系统下载的盘点模板填写。");
  const headers = rows[0];
  const skuColumn = headerIndex(headers, ["SKU", "商品SKU", "商品 SKU"]);
  const nameColumn = headerIndex(headers, ["商品名称", "商品", "名称"]);
  const quantityColumn = headerIndex(headers, ["实盘数量", "盘点数量", "实际数量"]);
  const reasonColumn = headerIndex(headers, ["盘点原因", "原因", "备注"]);
  if (quantityColumn < 0 || (skuColumn < 0 && nameColumn < 0)) throw new Error("未找到“SKU/商品名称”和“实盘数量”列；请使用系统下载的盘点模板。");

  const bySku = new Map(items.map((item) => [normalized(item.sku), item]));
  const byName = new Map<string, CountImportItem[]>();
  for (const item of items) { const key = normalized(item.itemName); byName.set(key, [...(byName.get(key) ?? []), item]); }
  const preview: StockCountImportPreview = { fileName, validLines: [], errors: [], warnings: [] };
  const found = new Set<string>();
  rows.slice(1).forEach((cells, offset) => {
    const row = offset + 2;
    const sku = skuColumn >= 0 ? text(cells[skuColumn]) : "";
    const name = nameColumn >= 0 ? text(cells[nameColumn]) : "";
    const rawQuantity = cells[quantityColumn];
    if (!sku && !name && text(rawQuantity) === "") return;
    if (text(rawQuantity) === "") { preview.warnings.push(`第 ${row} 行：未填写实盘数量，已跳过，未按 0 处理。`); return; }
    const quantity = typeof rawQuantity === "number" ? rawQuantity : Number(String(rawQuantity).replace(/,/g, ""));
    if (!Number.isFinite(quantity) || quantity < 0) { preview.errors.push(`第 ${row} 行：实盘数量必须是大于或等于 0 的数字。`); return; }
    const skuMatch = sku ? bySku.get(normalized(sku)) : undefined;
    const nameMatches = name ? byName.get(normalized(name)) ?? [] : [];
    if (!sku && nameMatches.length > 1) { preview.errors.push(`第 ${row} 行：商品名称“${name}”对应多个商品，请填写 SKU 后重新导入。`); return; }
    const item = sku ? skuMatch : nameMatches[0];
    if (!item) {
      preview.errors.push(sku ? `第 ${row} 行：未找到 SKU“${sku}”对应的本盘点商品。` : `第 ${row} 行：未找到商品名称“${name}”对应的本盘点商品。`);
      return;
    }
    if (sku && name && normalized(item.itemName) !== normalized(name)) preview.warnings.push(`第 ${row} 行：已按 SKU 匹配“${item.itemName}”，表内商品名称“${name}”未作为依据。`);
    if (found.has(item.itemId)) { preview.errors.push(`第 ${row} 行：商品“${item.itemName}”在表中重复，请只保留一行。`); return; }
    found.add(item.itemId);
    if (reasonColumn >= 0 && text(cells[reasonColumn]).length > 120) { preview.errors.push(`第 ${row} 行：盘点原因不能超过 120 字。`); return; }
    preview.validLines.push({ row, itemId: item.itemId, itemName: item.itemName, countedQuantity: quantity, reason: reasonColumn >= 0 ? text(cells[reasonColumn]) : "", matchedBy: skuMatch ? "SKU" : "商品名称" });
  });
  if (!preview.validLines.length && !preview.errors.length) preview.warnings.push("没有读取到已填写的实盘数量。请先在模板中填写数量后再上传。");
  return preview;
}
