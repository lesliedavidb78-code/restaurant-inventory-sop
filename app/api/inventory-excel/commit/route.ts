import { NextRequest, NextResponse } from "next/server";
import { sqlite } from "@/lib/db";
import { localStore } from "@/lib/local-store";
import { appendStockEventInTransaction, createItemInTransaction, ready } from "@/lib/services";
import { commitImportBatch, excelCommitSchema, importItemIndex, stableContentHash } from "@/lib/import-commit-support";

export async function POST(request: NextRequest) {
  try {
    const { preview, includeClosingStock } = excelCommitSchema.parse(await request.json());
    if (preview.errors.length || !preview.products.length && !preview.purchases.length && !preview.closingStock.length) throw new Error("导入预览无效，请重新选择文件。");
    await ready();
    const contentHash = stableContentHash({ products: preview.products, purchases: preview.purchases, closingStock: preview.closingStock, closingDate: preview.closingDate, includeClosingStock });
    const result = commitImportBatch({ ...localStore, kind: "inventory_excel", fileName: preview.fileName, fileHash: preview.fileHash, contentHash, sheetCount: preview.sheets.length }, () => {
      const index = importItemIndex(localStore.storeId); const seen = new Set<string>();
      let productCount = 0; let skipped = 0; let closingCount = 0; const warnings: string[] = [];
      for (const product of preview.products) {
        const sku = product.sku.toUpperCase();
        if (seen.has(sku)) throw new Error(`商品表第 ${product.row} 行 SKU 重复：${product.sku}`);
        seen.add(sku);
        if (index.bySku.has(sku)) { skipped += 1; continue; }
        const created = createItemInTransaction({ ...product, ...localStore }); index.bySku.set(sku, created.id); productCount += 1;
      }
      const warehouse = sqlite.prepare("SELECT id FROM warehouses WHERE store_id=? ORDER BY created_at,id LIMIT 1").get(localStore.storeId) as { id: string } | undefined;
      if (!warehouse) throw new Error("未找到默认仓库。");
      const resolve = (sku: string) => { const id = index.bySku.get(sku.toUpperCase()); if (!id) throw new Error(`库存商品 SKU 不存在：${sku}；未导入任何数据。`); return id; };
      const purchaseSkus = new Set(preview.purchases.map((row) => row.sku.toUpperCase())); const closingSeen = new Set<string>();
      if (includeClosingStock) for (const closing of preview.closingStock) {
        const sku = closing.sku.toUpperCase(); const itemId = resolve(closing.sku);
        if (closingSeen.has(sku)) throw new Error(`期末结余 SKU 重复：${closing.sku}`); closingSeen.add(sku);
        const hasEvents = sqlite.prepare("SELECT id FROM stock_events WHERE store_id=? AND item_id=? LIMIT 1").get(localStore.storeId, itemId);
        if (hasEvents || purchaseSkus.has(sku)) { warnings.push(`${closing.sku} 已有库存流水或同批采购，期末结余不能再次作为初始库存叠加；请通过盘点核对，原账本未覆盖。`); continue; }
        if (!closing.quantity) continue;
        appendStockEventInTransaction({ ...localStore, itemId, warehouseId: warehouse.id, eventType: "adjustment", sourceType: "opening", businessDate: preview.closingDate, quantity: closing.quantity, quantityUom: closing.quantityUom, note: `Excel 导入初始结余：${preview.fileName}` }); closingCount += 1;
      }
      for (const purchase of preview.purchases) appendStockEventInTransaction({ ...localStore, itemId: resolve(purchase.sku), warehouseId: warehouse.id, eventType: "purchase", businessDate: preview.closingDate, quantity: purchase.quantity, quantityUom: purchase.quantityUom, unitCostCents: purchase.unitCostCents, note: `Excel 导入采购汇总：${preview.fileName}` });
      return { productCount, skipped, closingCount, purchaseCount: preview.purchases.length, warnings };
    });
    return NextResponse.json(result);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Excel 导入失败" }, { status: 400 }); }
}
