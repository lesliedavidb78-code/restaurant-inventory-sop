import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getDashboard } from "@/lib/services";
import { localStore } from "@/lib/local-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const dashboard = await getDashboard(localStore.storeId);
  const workbook = XLSX.utils.book_new();
  const products = dashboard.items.map((item) => ({
    SKU: item.sku,
    商品名称: item.name,
    规格: item.specification || "",
    分类: item.category,
    采购单位: item.purchaseUom,
    最小库存单位: item.stockUom,
    每采购单位换算数量: item.unitsPerPurchase,
    每最小单位净含量: item.unitNetContent,
    净含量单位: item.contentUom,
    默认采购价: item.purchasePriceCents / 100,
    预警天数: item.warningDays,
    目标库存天数: item.targetDays,
    补货系数: item.replenishmentFactor,
  }));
  const stock = dashboard.stock.map((row) => ({
    SKU: row.sku,
    商品名称: row.itemName,
    分类: row.category,
    仓库: row.warehouseName,
    当前数量: row.quantity,
    库存单位: row.uom,
    日均用量: row.averageDailyUsage,
    动态预警线: row.warningQuantity,
    目标库存: row.targetQuantity,
    建议采购量: row.suggestedPurchaseQuantity,
    历史统计天数: row.historyDays,
    平均成本: row.averageCostCents / 100,
    库存估值: (row.quantity * row.averageCostCents) / 100,
    库存状态: row.isWarning ? "预警" : row.historyMode === "no_data" ? "数据不足" : "正常",
  }));
  const productSheet = XLSX.utils.json_to_sheet(products);
  const stockSheet = XLSX.utils.json_to_sheet(stock);
  productSheet["!cols"] = [12, 20, 22, 18, 12, 14, 18, 18, 14, 14, 12, 14, 12].map((wch) => ({ wch }));
  stockSheet["!cols"] = [12, 20, 18, 16, 14, 12, 14, 14, 14, 14, 14, 12, 14, 14, 12].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, productSheet, "商品档案");
  XLSX.utils.book_append_sheet(workbook, stockSheet, "当前库存");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true });
  const fileName = `门店进销存导出_${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(buffer, { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Cache-Control": "no-store",
  } });
}
