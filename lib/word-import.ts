import mammoth from "mammoth";
import { createHash } from "node:crypto";
import { parsePackageSpecification } from "@/lib/domain/package-spec";

export type WordProductRow = { row: number; sku: string; name: string; specification: string; category: string; purchaseUom: string; stockUom: string; unitsPerPurchase: number; unitNetContent: number; contentUom: string; purchasePrice: number; minimumQty: number };
export type WordStockRow = { row: number; businessDate: string; eventType: string; sku: string; itemName: string; quantity: number; quantityUom: "purchase" | "stock"; unitCost?: number; note?: string };
export type WordPreview = { fileName: string; fileHash?: string; products: WordProductRow[]; stockEvents: WordStockRow[]; errors: string[]; tables: number };

const decode = (text: string) => text.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").trim();
const normalise = (text: string) => text.toLowerCase().replace(/[\s（）()_\-]/g, "");
const cell = (headers: string[], cells: string[], names: string[]) => {
  const index = headers.findIndex((header) => names.some((name) => header === normalise(name) || header.includes(normalise(name))));
  return index >= 0 ? (cells[index] ?? "").trim() : "";
};
const toNumber = (value: string, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const typeMap: Record<string, string> = { "采购入库": "purchase", "入库": "purchase", "销售出库": "sale", "销售": "sale", "领料出库": "issue", "领料": "issue", "退料入库": "issue_return", "退料": "issue_return", "报损出库": "waste", "报损": "waste", "盘点调整": "adjustment", "调拨入库": "transfer_in", "调拨出库": "transfer_out" };

function extractTables(html: string) {
  return [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].map((table) => [...table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((part) => decode(part[1]))));
}

export async function parseWordTables(buffer: Buffer, fileName: string): Promise<WordPreview> {
  const result = await mammoth.convertToHtml({ buffer });
  const preview: WordPreview = { fileName, fileHash: createHash("sha256").update(buffer).digest("hex"), products: [], stockEvents: [], errors: [], tables: 0 };
  const tables = extractTables(result.value); preview.tables = tables.length;
  if (!tables.length) preview.errors.push("未识别到 Word 表格；请使用 .docx 中的普通表格，不支持图片或扫描件。");
  tables.forEach((table, index) => {
    if (table.length < 2) return;
    const headers = table[0].map(normalise);
    const isProduct = headers.some((header) => header.includes("sku")) && headers.some((header) => header.includes("商品"));
    const isStock = headers.some((header) => header.includes("业务类型") || header.includes("类型")) && headers.some((header) => header.includes("数量"));
    if (!isProduct && !isStock) { preview.errors.push(`第 ${index + 1} 张表未识别：请使用商品建档或进出库标准表头。`); return; }
    table.slice(1).forEach((cells, rowIndex) => {
      const row = rowIndex + 2;
      if (!cells.some(Boolean)) return;
      if (isProduct) {
        const specification = cell(headers, cells, ["规格", "规格型号"]);
        const purchaseUom = cell(headers, cells, ["采购单位"]) || "件";
        const stockUom = cell(headers, cells, ["库存单位", "最小单位"]) || purchaseUom;
        const packageSpec = parsePackageSpecification(specification, purchaseUom, stockUom);
        const item: WordProductRow = { row, sku: cell(headers, cells, ["SKU", "商品SKU"]), name: cell(headers, cells, ["商品名称", "商品名", "名称"]), specification, category: cell(headers, cells, ["分类"]) || "未分类", purchaseUom: packageSpec?.purchaseUom ?? purchaseUom, stockUom: packageSpec?.stockUom ?? stockUom, unitsPerPurchase: packageSpec?.unitsPerPurchase ?? toNumber(cell(headers, cells, ["每采购单位数量", "换算数量", "每箱数量"]), 1), unitNetContent: packageSpec?.unitNetContent ?? toNumber(cell(headers, cells, ["每最小单位净含量", "净含量"]), 1), contentUom: packageSpec?.contentUom ?? (cell(headers, cells, ["净含量单位"]) || "kg"), purchasePrice: toNumber(cell(headers, cells, ["采购价", "单价"])), minimumQty: toNumber(cell(headers, cells, ["安全库存", "最低库存"])), };
        if (!item.sku || !item.name) preview.errors.push(`商品表第 ${row} 行缺少 SKU 或商品名称。`); else preview.products.push(item);
      }
      if (isStock) {
        const label = cell(headers, cells, ["业务类型", "类型"]); const eventType = typeMap[label] ?? label;
        const item: WordStockRow = { row, businessDate: cell(headers, cells, ["业务日期", "日期"]), eventType, sku: cell(headers, cells, ["SKU", "商品SKU"]), itemName: cell(headers, cells, ["商品名称", "商品名", "名称"]), quantity: toNumber(cell(headers, cells, ["数量"])), quantityUom: /采购|整箱|箱/.test(cell(headers, cells, ["录入单位", "单位"])) ? "purchase" : "stock", unitCost: toNumber(cell(headers, cells, ["采购单价", "单价"]), NaN), note: cell(headers, cells, ["备注"]), };
        if (!/^\d{4}-\d{2}-\d{2}$/.test(item.businessDate) || (!item.sku && !item.itemName) || item.quantity <= 0 || !Object.values(typeMap).includes(item.eventType)) preview.errors.push(`进出库表第 ${row} 行格式不正确：需要日期、商品、类型和大于 0 的数量。`); else preview.stockEvents.push(item);
      }
    });
  });
  return preview;
}
