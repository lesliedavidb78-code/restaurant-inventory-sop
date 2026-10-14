import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseSalesWorkbook } from "@/lib/sales-import";

describe("美团销量 Excel 识别", () => {
  it("读取菜品名称、销售 SKU 和销量，并跳过合计行", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ["2026年8月24日销售明细"],
      ["菜品名称", "菜品SKU", "销售数量"],
      ["嫩牛肉", "MT-01", 3],
      ["合计", "", 3],
    ]), "销量");
    const preview = parseSalesWorkbook(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), "8月24日美团销量.xlsx");
    expect(preview).toMatchObject({ businessDate: "2026-08-24", sheetName: "销量", errors: [] });
    expect(preview.lines).toEqual([{ row: 3, dishName: "嫩牛肉", salesSku: "MT-01", quantity: 3 }]);
  });
});
