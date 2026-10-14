import { NextRequest, NextResponse } from "next/server";
import { appendStockEventInTransaction, createItemInTransaction, ready } from "@/lib/services";
import { sqlite } from "@/lib/db";
import { localStore } from "@/lib/local-store";
import { commitImportBatch, importItemIndex, resolveImportItem, stableContentHash, wordPreviewSchema } from "@/lib/import-commit-support";

export async function POST(request: NextRequest) {
  try {
    const preview = wordPreviewSchema.parse(await request.json());
    if (preview.errors.length || (!preview.products.length && !preview.stockEvents.length)) throw new Error("导入预览无效，请先修正错误。");
    await ready();
    const contentHash = stableContentHash({ products: preview.products, stockEvents: preview.stockEvents });
    const result = commitImportBatch({ ...localStore, kind: "word", fileName: preview.fileName, fileHash: `word:${preview.fileHash ?? contentHash}`, contentHash, sheetCount: preview.tables }, () => {
      const index = importItemIndex(localStore.storeId);
      const seen = new Set<string>(); let productCount = 0; let skipped = 0;
      for (const row of preview.products) {
        const sku = row.sku.toUpperCase();
        if (seen.has(sku)) throw new Error(`商品表第 ${row.row} 行 SKU 重复：${row.sku}`);
        seen.add(sku);
        if (index.bySku.has(sku)) { skipped += 1; continue; }
        const created = createItemInTransaction({ ...row, purchasePriceCents: Math.round(row.purchasePrice * 100), ...localStore });
        index.bySku.set(sku, created.id); index.byName.set(row.name, [...(index.byName.get(row.name) ?? []), created.id]); productCount += 1;
      }
      const warehouse = sqlite.prepare("SELECT id FROM warehouses WHERE store_id=? ORDER BY created_at,id LIMIT 1").get(localStore.storeId) as { id: string } | undefined;
      if (!warehouse) throw new Error("未找到默认仓库。");
      for (const row of preview.stockEvents) {
        const itemId = resolveImportItem(index, row);
        appendStockEventInTransaction({ ...localStore, itemId, warehouseId: warehouse.id, eventType: row.eventType, businessDate: row.businessDate, quantity: row.quantity, quantityUom: row.quantityUom, unitCostCents: row.unitCost === undefined ? undefined : row.unitCost * 100, note: row.note });
      }
      return { productCount, skipped, stockCount: preview.stockEvents.length };
    });
    return NextResponse.json(result);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Word 导入失败" }, { status: 400 }); }
}
