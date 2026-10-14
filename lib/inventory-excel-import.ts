import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { parsePackageSpecification } from "@/lib/domain/package-spec";

export type InventoryExcelProduct = {
  row: number;
  sku: string;
  name: string;
  specification: string;
  category: string;
  purchaseUom: string;
  stockUom: string;
  unitsPerPurchase: number;
  unitNetContent: number;
  contentUom: string;
  purchasePriceCents: number;
  minimumQty: number;
};

export type InventoryExcelClosing = { sku: string; name: string; category: string; quantity: number; uom: string; quantityUom: "purchase" | "stock" };
export type InventoryExcelPurchase = { sku: string; name: string; category: string; quantity: number; uom: string; quantityUom: "purchase" | "stock"; unitCostCents: number };
export type InventoryExcelPreview = {
  fileName: string;
  fileHash: string;
  closingDate: string;
  sheets: { name: string; productCount: number; closingCount: number; purchaseCount: number; mode: "ledger" | "purchase_only" }[];
  products: InventoryExcelProduct[];
  closingStock: InventoryExcelClosing[];
  purchases: InventoryExcelPurchase[];
  warnings: string[];
  errors: string[];
};

const ignored = /^(合计|总计|小计|备注|名称)$/;
const asText = (value: unknown) => String(value ?? "").trim();
const asNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : Number(String(value ?? "").replace(/,/g, ""));
const safeSkuPart = (value: string) => value.replace(/[^A-Za-z0-9]/g, "").slice(0, 16).toUpperCase();
const lastDay = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;

function findColumn(rows: unknown[][], labels: string[]) {
  for (let row = 0; row < Math.min(rows.length, 12); row += 1) {
    const column = rows[row].findIndex((cell) => labels.includes(asText(cell)));
    if (column >= 0) return column;
  }
  return -1;
}

function inferClosingDate(fileName: string, rows: unknown[][]) {
  const header = `${fileName} ${rows.slice(0, 4).flat().map(asText).join(" ")}`;
  const full = header.match(/(20\d{2})\D{0,4}(\d{1,2})月/);
  if (full) return lastDay(Number(full[1]), Number(full[2]));
  const month = header.match(/(\d{1,2})月/);
  return lastDay(new Date().getFullYear(), month ? Number(month[1]) : new Date().getMonth() + 1);
}

/** 识别“期末结余台账”和“本月采购汇总”两种门店库存表版式。 */
export function parseInventoryWorkbook(buffer: Buffer, fileName: string): InventoryExcelPreview {
  const workbook = XLSX.read(buffer, { cellFormula: false, cellStyles: false });
  const preview: InventoryExcelPreview = {
    fileName,
    fileHash: createHash("sha256").update(buffer).digest("hex"),
    closingDate: inferClosingDate(fileName, []),
    sheets: [], products: [], closingStock: [], purchases: [], warnings: [], errors: [],
  };

  workbook.SheetNames.forEach((sheetName, sheetIndex) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", blankrows: false });
    const nameColumn = findColumn(rows, ["名称", "商品名称", "品名"]);
    const specificationColumn = findColumn(rows, ["规格", "规格型号"]);
    const unitColumn = findColumn(rows, ["单位"]);
    const closingColumn = findColumn(rows, ["结余"]);
    const amountColumn = findColumn(rows, ["金额", "价格"]);
    const headerEnd = rows.slice(0, 12).reduce((last, row, rowIndex) => row.some((cell) => ["入库", "出库", "结余", "金额", "价格"].includes(asText(cell))) ? rowIndex : last, -1);
    const inboundColumns: number[] = [];
    rows.slice(0, Math.max(headerEnd + 1, 0)).forEach((row) => row.forEach((cell, index) => { if (asText(cell) === "入库") inboundColumns.push(index); }));
    const inboundColumn = inboundColumns.length ? Math.min(...inboundColumns) : -1;
    const dataStart = Math.max(headerEnd + 1, 0);
    const hasClosing = closingColumn >= 0;
    const hasPurchaseSummary = inboundColumn >= 0 && amountColumn >= 0 && !hasClosing;
    let productCount = 0;
    let closingCount = 0;
    let purchaseCount = 0;

    if (nameColumn < 0 || dataStart < 1) {
      preview.warnings.push(`“${sheetName}”未找到完整的“名称 + 月汇总”表头，已跳过。`);
      preview.sheets.push({ name: sheetName, productCount, closingCount, purchaseCount, mode: "purchase_only" });
      return;
    }

    rows.slice(dataStart).forEach((cells, offset) => {
      const name = asText(cells[nameColumn]);
      if (!name || ignored.test(name)) return;
      const specification = specificationColumn >= 0 ? asText(cells[specificationColumn]) : "";
      const uom = (unitColumn >= 0 ? asText(cells[unitColumn]) : "") || "件";
      const row = dataStart + offset + 1;
      const sku = `X${String(sheetIndex + 1).padStart(2, "0")}-${String(row).padStart(3, "0")}-${safeSkuPart(name) || "ITEM"}`.slice(0, 40);
      const packageSpec = parsePackageSpecification(specification, uom, uom);
      // 原表“单位”是这行数量的录入单位。若规格将一件拆成多袋，则结余/采购数量
      // 必须按采购单位写入，库存流水会自动折算为最小库存单位。
      const quantityUom: "purchase" | "stock" = packageSpec && packageSpec.purchaseUom !== packageSpec.stockUom ? "purchase" : "stock";
      preview.products.push({
        row, sku, name, specification, category: sheetName,
        purchaseUom: packageSpec?.purchaseUom ?? uom,
        stockUom: packageSpec?.stockUom ?? uom,
        unitsPerPurchase: packageSpec?.unitsPerPurchase ?? 1,
        unitNetContent: packageSpec?.unitNetContent ?? 1,
        contentUom: packageSpec?.contentUom ?? uom,
        purchasePriceCents: 0, minimumQty: 0,
      });
      productCount += 1;

      if (hasClosing) {
        const quantity = asNumber(cells[closingColumn]);
        if (Number.isFinite(quantity) && quantity >= 0) {
          preview.closingStock.push({ sku, name, category: sheetName, quantity, uom, quantityUom });
          closingCount += 1;
        }
      } else if (hasPurchaseSummary) {
        const quantity = asNumber(cells[inboundColumn]);
        const amount = asNumber(cells[amountColumn]);
        if (Number.isFinite(quantity) && quantity > 0 && Number.isFinite(amount) && amount >= 0) {
          // 汇总金额取整到分，再除以原数量；每克成本不能先四舍五入到整分。
          preview.purchases.push({ sku, name, category: sheetName, quantity, uom, quantityUom, unitCostCents: Math.round(amount * 100) / quantity });
          purchaseCount += 1;
        }
      }
    });

    preview.sheets.push({ name: sheetName, productCount, closingCount, purchaseCount, mode: hasClosing ? "ledger" : "purchase_only" });
    if (!hasClosing && productCount && !hasPurchaseSummary) preview.warnings.push(`“${sheetName}”已建商品档案，但没有可用于导入的“结余”或“入库 + 金额/价格”数据。`);
    if (hasPurchaseSummary) preview.warnings.push(`“${sheetName}”按本月汇总导入 ${purchaseCount} 条采购入库；单位成本按“金额 ÷ 数量”折算。`);
    preview.closingDate = inferClosingDate(fileName, rows);
  });

  if (!preview.products.length) preview.errors.push("未识别到商品行；请确认文件包含“名称、规格、单位”和“月汇总”表头。");
  return preview;
}
