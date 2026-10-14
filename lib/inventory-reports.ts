import { randomUUID } from "node:crypto";
import { ready } from "./services";
import { sqlite } from "./db";
import { appendStockEventInTransaction, assertStockPeriodOpen, assertStockWarehouse } from "./stock-ledger";

type Context = { storeId: string; actor: string; role: string };

export async function getInventoryReports(storeId: string, period: string) {
  await ready();
  const openingItems = sqlite.prepare(`SELECT i.id,i.name,i.sku,i.stock_uom stockUom,i.purchase_uom purchaseUom,i.units_per_purchase unitsPerPurchase,i.purchase_price_cents purchasePriceCents
    FROM items i WHERE i.store_id=? AND i.active=1 AND NOT EXISTS (SELECT 1 FROM stock_events e WHERE e.store_id=i.store_id AND e.item_id=i.id) ORDER BY i.name`).all(storeId);
  const issueSummary = sqlite.prepare(`SELECT i.category,i.name itemName,i.stock_uom stockUom,ROUND(-SUM(e.quantity_change),3) quantity,ROUND(-SUM(e.total_cost_cents)/100.0,2) amount
    FROM stock_events e JOIN items i ON i.id=e.item_id WHERE e.store_id=? AND e.event_type='issue' AND substr(e.business_date,1,7)=? GROUP BY i.category,i.id ORDER BY i.category,i.name`).all(storeId,period);
  const costTrend = sqlite.prepare(`SELECT i.name itemName,i.stock_uom stockUom,e.business_date businessDate,e.unit_cost_cents/100.0 unitCost
    FROM stock_events e JOIN items i ON i.id=e.item_id WHERE e.store_id=? AND e.event_type='purchase' AND substr(e.business_date,1,7)=? ORDER BY i.name,e.business_date DESC`).all(storeId,period);
  const margins = sqlite.prepare("SELECT category,product_name productName,uom,selling_price_cents/100.0 sellingPrice,cost_cents/100.0 cost,gross_profit_cents/100.0 grossProfit,ROUND(gross_margin*100,1) grossMargin FROM product_margins WHERE store_id=? AND period=? ORDER BY category,product_name").all(storeId,period);
  return { openingItems, issueSummary, costTrend, margins };
}

export async function commitOpeningStock(input: Context & { warehouseId: string; businessDate: string; lines: { itemId: string; quantity: number; quantityUom: "purchase" | "stock"; unitCostCents: number }[] }) {
  await ready(); if (!['owner','storekeeper'].includes(input.role)) throw new Error("当前角色无期初库存权限"); if (!input.lines.length) throw new Error("请填写至少一条期初库存");
  sqlite.transaction(() => {
    assertStockPeriodOpen(input.storeId,input.businessDate);
    assertStockWarehouse(input.storeId,input.warehouseId);
    for (const line of input.lines) {
      if (!Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unitCostCents) || line.unitCostCents < 0) throw new Error("期初数量或单价不正确");
      const item = sqlite.prepare("SELECT purchase_uom purchaseUom,stock_uom stockUom,units_per_purchase unitsPerPurchase FROM items WHERE id=? AND store_id=? AND active=1").get(line.itemId,input.storeId) as any;
      if (!item) throw new Error("期初商品不存在或已停用");
      const existing = sqlite.prepare("SELECT 1 FROM stock_events WHERE store_id=? AND item_id=? LIMIT 1").get(input.storeId,line.itemId);
      if (existing) throw new Error("该商品已有库存流水，不能再写入期初库存；请使用盘点调整");
      appendStockEventInTransaction({...input,...line,eventType:"adjustment",sourceType:"opening",sourceId:randomUUID(),note:"期初库存"});
    }
  })(); return { count: input.lines.length };
}
