import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseStockCountWorkbook } from "@/lib/stock-count-import";

function workbook(rows: unknown[][]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "盘点录入");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("盘点表回传导入", () => {
  it("空白实盘数保留未盘状态，明确填零才导入零", () => {
    const result = parseStockCountWorkbook(workbook([["SKU", "实盘数量"], ["A", ""], ["B", 0]]), "盘点.xlsx", [{ itemId: "a", sku: "A", itemName: "牛肉" }, { itemId: "b", sku: "B", itemName: "毛肚" }]);
    expect(result.validLines.map((line) => [line.itemId, line.countedQuantity])).toEqual([["b", 0]]);
    expect(result.warnings.length).toBe(1);
  });
  it("未知 SKU 不回退名称，同名商品必须用 SKU 消歧", () => {
    const result = parseStockCountWorkbook(workbook([["SKU", "商品名称", "实盘数量"], ["UNKNOWN", "牛肉", 2], ["", "牛肉", 3], ["B", "牛肉", 4]]), "盘点.xlsx", [{ itemId: "a", sku: "A", itemName: "牛肉" }, { itemId: "b", sku: "B", itemName: "牛肉" }]);
    expect(result.validLines.map((line) => line.itemId)).toEqual(["b"]);
    expect(result.errors.length).toBe(2);
  });
  it("按 SKU 优先识别，允许名称作为备用匹配，并返回未识别行", () => {
    const preview = parseStockCountWorkbook(workbook([
      ["SKU", "商品名称", "分类", "库存单位", "实盘数量", "盘点原因"],
      ["BEEF-01", "嫩牛肉", "肉类", "斤", 12.5, "损耗复核"],
      ["", "鲜毛肚", "肉类", "斤", 3, ""],
      ["UNKNOWN", "未知商品", "", "", 1, ""],
    ]), "门店总仓盘点表.xlsx", [
      { itemId: "item-beef", sku: "BEEF-01", itemName: "嫩牛肉" },
      { itemId: "item-tripe", sku: "TRIPE-01", itemName: "鲜毛肚" },
    ]);

    expect(preview.validLines).toEqual([
      { row: 2, itemId: "item-beef", itemName: "嫩牛肉", countedQuantity: 12.5, reason: "损耗复核", matchedBy: "SKU" },
      { row: 3, itemId: "item-tripe", itemName: "鲜毛肚", countedQuantity: 3, reason: "", matchedBy: "商品名称" },
    ]);
    expect(preview.errors).toContain("第 4 行：未找到 SKU“UNKNOWN”对应的本盘点商品。");
  });
});
