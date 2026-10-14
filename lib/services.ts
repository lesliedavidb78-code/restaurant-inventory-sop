import { randomUUID } from "node:crypto";
import { businessDate } from "@/lib/domain/business-date";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, ensureSchema, sqlite } from "./db";
import { seedDatabase, STORE_ID } from "./db/seed";
import { bankTransactions, booths, counterparties, expenseEntries, grossProfitSnapshots, importBatches, items, periodCloses, productMargins, salesSummaries, warehouses } from "./db/schema";
import { calculateProductMargin } from "./domain/product-margin";
import { calculateProfit } from "./domain/report";
import { calculateReplenishment } from "./domain/replenishment";
import { nextSkuForName } from "./domain/sku";
import { appendStockEventInTransaction, assertStockPeriodOpen, assertStockWarehouse, stockBalance, type StockLedgerInput } from "./stock-ledger";
import { idempotentMutation } from "./mutation-idempotency";
import { getInventoryIntegrityIssues } from "./inventory-integrity";
export { appendStockEventInTransaction } from "./stock-ledger";

export async function ready() {
  ensureSchema();
  await seedDatabase();
}

export async function getDashboard(storeId = STORE_ID, period = "2026-06") {
  await ready();
  const [sales] = await db.select().from(salesSummaries).where(and(eq(salesSummaries.storeId, storeId), eq(salesSummaries.period, period)));
  const gross = await db.select({ boothId: grossProfitSnapshots.boothId, boothName: booths.name, grossRevenueCents: grossProfitSnapshots.grossRevenueCents, netRevenueCents: grossProfitSnapshots.netRevenueCents, discountCents: grossProfitSnapshots.discountCents, openingCents: grossProfitSnapshots.openingCents, inboundCents: grossProfitSnapshots.inboundCents, outboundCents: grossProfitSnapshots.outboundCents, closingCents: grossProfitSnapshots.closingCents, cogsCents: grossProfitSnapshots.cogsCents, grossProfitCents: grossProfitSnapshots.grossProfitCents })
    .from(grossProfitSnapshots).innerJoin(booths, eq(grossProfitSnapshots.boothId, booths.id)).where(and(eq(grossProfitSnapshots.storeId, storeId), eq(grossProfitSnapshots.period, period))).orderBy(desc(grossProfitSnapshots.grossRevenueCents));
  const expenses = await db.select().from(expenseEntries).where(and(eq(expenseEntries.storeId, storeId), eq(expenseEntries.period, period))).orderBy(desc(expenseEntries.amountCents));
  const totalCogs = gross.reduce((sum, row) => sum + row.cogsCents, 0);
  const totalExpense = expenses.reduce((sum, row) => sum + row.amountCents, 0);
  const profit = calculateProfit({ grossRevenueCents: sales?.grossRevenueCents ?? 0, cogsCents: totalCogs, expenseCents: totalExpense });
  const trends = await db.select({ period: salesSummaries.period, revenueCents: salesSummaries.grossRevenueCents }).from(salesSummaries).where(eq(salesSummaries.storeId, storeId)).orderBy(asc(salesSummaries.period));
  const bank = sqlite.prepare("SELECT id,store_id storeId,business_date businessDate,summary,income_cents incomeCents,expense_cents expenseCents,balance_cents balanceCents,source_batch_id sourceBatchId,created_at createdAt,created_by createdBy FROM bank_transactions WHERE store_id=? AND business_date<? ORDER BY business_date DESC,created_at DESC LIMIT 1").get(storeId, `${period}-32`) as typeof bankTransactions.$inferSelect | undefined;
  const parties = await db.select().from(counterparties).where(and(eq(counterparties.storeId, storeId), eq(counterparties.period, period))).orderBy(desc(counterparties.originalCents));
  const productMarginRows = await db.select().from(productMargins).where(and(eq(productMargins.storeId, storeId), eq(productMargins.period, period))).orderBy(asc(productMargins.category), desc(productMargins.grossMargin));
  const [close] = await db.select().from(periodCloses).where(and(eq(periodCloses.storeId, storeId), eq(periodCloses.period, period)));
  const imports = await db.select().from(importBatches).where(eq(importBatches.storeId, storeId)).orderBy(desc(importBatches.createdAt)).limit(5);
  const itemList = await db.select({ id: items.id, sku: items.sku, name: items.name, specification: items.specification, category: items.category, purchaseUom: items.purchaseUom, stockUom: items.stockUom, unitsPerPurchase: items.unitsPerPurchase, unitNetContent: items.unitNetContent, contentUom: items.contentUom, purchasePriceCents: items.purchasePriceCents, minimumQty: items.minimumQty, warningDays: items.warningDays, targetDays: items.targetDays, replenishmentFactor: items.replenishmentFactor, active: items.active }).from(items).where(eq(items.storeId, storeId));
  const warehouseList = await db.select().from(warehouses).where(eq(warehouses.storeId, storeId));
  const categorySettings = sqlite.prepare("SELECT name,warning_days warningDays,target_days targetDays,factor FROM category_replenishment_settings WHERE store_id=? ORDER BY name").all(storeId) as { name: string; warningDays: number; targetDays: number; factor: number }[];
  const demandEvents = sqlite.prepare("SELECT item_id itemId,business_date businessDate,event_type eventType,quantity_change quantityChange FROM stock_events WHERE store_id=? AND event_type IN ('sale','issue','issue_return') ORDER BY business_date").all(storeId) as { itemId: string; businessDate: string; eventType: string; quantityChange: number }[];
  const demandEventsByItem = new Map<string, typeof demandEvents>();
  for (const event of demandEvents) { const group=demandEventsByItem.get(event.itemId); if(group) group.push(event); else demandEventsByItem.set(event.itemId,[event]); }
  const asOfDate = process.env.RESTAURANT_AS_OF_DATE || businessDate();
  const replenishFor = (itemId: string, currentQuantity: number, item: typeof itemList[number]) => calculateReplenishment({
    asOfDate, currentQuantity, warningDays: item.warningDays, targetDays: item.targetDays, factor: item.replenishmentFactor,
    events: demandEventsByItem.get(itemId) ?? [],
  });
  const eventTotals = sqlite.prepare("SELECT item_id, warehouse_id, SUM(quantity_change) quantity, SUM(total_cost_cents) value_cents FROM stock_events WHERE store_id=? GROUP BY item_id,warehouse_id").all(storeId) as { item_id: string; warehouse_id: string; quantity: number; value_cents: number }[];
  const activeEventTotals = eventTotals.filter((row) => itemList.some((item) => item.id === row.item_id && item.active) && warehouseList.some((warehouse) => warehouse.id === row.warehouse_id));
  const stockWithEvents = activeEventTotals.map((row) => {
    const item = itemList.find((x) => x.id === row.item_id && x.active)!;
    const warehouse = warehouseList.find((x) => x.id === row.warehouse_id)!;
    const replenishment = replenishFor(item.id, row.quantity, item);
    return { ...row, itemName: item.name, sku: item.sku, category: item.category, purchaseUom: item.purchaseUom, unitsPerPurchase: item.unitsPerPurchase, unitNetContent: item.unitNetContent, contentUom: item.contentUom, uom: item.stockUom, minimumQty: item.minimumQty, warningDays: item.warningDays, targetDays: item.targetDays, replenishmentFactor: item.replenishmentFactor, warehouseName: warehouse.name, averageCostCents: row.quantity === 0 ? 0 : row.value_cents / row.quantity, hasStockEvents: true, ...replenishment };
  });
  // 商品建档后尚未入库时也要能在总览中查到，显示为主仓的 0 库存。
  const eventItemIds = new Set(activeEventTotals.map((row) => row.item_id));
  const defaultWarehouse = warehouseList[0];
  const stockWithoutEvents = defaultWarehouse ? itemList.filter((item) => item.active && !eventItemIds.has(item.id)).map((item) => {
    const replenishment = replenishFor(item.id, 0, item);
    return {
      item_id: item.id, warehouse_id: defaultWarehouse.id, quantity: 0, value_cents: 0,
      itemName: item.name, sku: item.sku, category: item.category, purchaseUom: item.purchaseUom,
      unitsPerPurchase: item.unitsPerPurchase, unitNetContent: item.unitNetContent, contentUom: item.contentUom,
      uom: item.stockUom, minimumQty: item.minimumQty, warningDays: item.warningDays, targetDays: item.targetDays,
      replenishmentFactor: item.replenishmentFactor, warehouseName: defaultWarehouse.name, averageCostCents: 0, hasStockEvents: false,
      ...replenishment,
    };
  }) : [];
  const stock = [...stockWithEvents, ...stockWithoutEvents].sort((a, b) => Number(b.isWarning) - Number(a.isWarning) || b.suggestedPurchaseQuantity - a.suggestedPurchaseQuantity || a.itemName.localeCompare(b.itemName, "zh-CN"));
  const stockRecords = sqlite.prepare("SELECT e.id,e.item_id itemId,e.warehouse_id warehouseId,e.event_type eventType,e.business_date businessDate,e.input_quantity inputQuantity,e.input_uom inputUom,e.conversion_factor conversionFactor,CASE WHEN e.conversion_factor<>1 OR e.input_uom=i.purchase_uom THEN 'purchase' ELSE 'stock' END quantityUom,CASE WHEN e.conversion_factor=1 AND i.units_per_purchase=1 THEN i.stock_uom ELSE e.input_uom END displayUom,e.input_unit_cost_cents inputUnitCostCents,e.quantity_change quantityChange,e.unit_cost_cents unitCostCents,e.note,e.source_type sourceType,e.created_at createdAt,i.name itemName,i.sku,i.purchase_uom purchaseUom,i.stock_uom stockUom,w.name warehouseName FROM stock_events e JOIN items i ON i.id=e.item_id JOIN warehouses w ON w.id=e.warehouse_id WHERE e.store_id=? ORDER BY e.created_at DESC,e.business_date DESC,e.id DESC").all(storeId) as { id: string; itemId: string; warehouseId: string; eventType: string; businessDate: string; inputQuantity: number | null; inputUom: string | null; conversionFactor:number; quantityUom:"purchase"|"stock"; displayUom: string | null; inputUnitCostCents: number | null; quantityChange: number; unitCostCents: number; note: string | null; sourceType: string; createdAt: string; itemName: string; sku: string; purchaseUom: string; stockUom: string; warehouseName: string }[];
  return { period, sales, gross, productMargins: productMarginRows, expenses, totalCogs, totalExpense, profit, trends, bank, parties, close, imports, stock, stockRecords, items: itemList.filter((item) => item.active), categorySettings, warehouses: warehouseList,integrityIssues:getInventoryIntegrityIssues(storeId) };
}

export type StockInput = StockLedgerInput;

export async function appendStockEvent(input: StockInput) {
  await ready();
  return idempotentMutation(input.storeId,input.requestId,"stock_event",input,() => appendStockEventInTransaction(input));
}

export async function clearStockAndMaybeDeactivate(input: { storeId: string; itemId: string; warehouseId: string; businessDate: string; keepVisible: boolean; actor: string; role: string }) {
  await ready();
  if (!['owner','storekeeper'].includes(input.role)) throw new Error("当前角色无库存清理权限");
  const item = sqlite.prepare("SELECT name,sku,stock_uom stockUom,active FROM items WHERE store_id=? AND id=?").get(input.storeId, input.itemId) as { name: string; sku: string; stockUom: string; active: number } | undefined;
  if (!item?.active) throw new Error("商品不存在或已停用");
  const result = sqlite.transaction(() => {
    assertStockPeriodOpen(input.storeId,input.businessDate);
    assertStockWarehouse(input.storeId,input.warehouseId);
    const balance = stockBalance(input.storeId,input.itemId,input.warehouseId);
    if (balance.quantity <= 0.000001) throw new Error("该商品当前库存已为 0，无需重复清理");
    const {id:eventId}=appendStockEventInTransaction({...input,eventType:"waste",quantity:balance.quantity,quantityUom:"stock",note:"库存清理"});
    const now = new Date().toISOString();
    sqlite.prepare("INSERT INTO audit_logs (id,store_id,action,entity_type,entity_id,payload_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)")
      .run(randomUUID(), input.storeId, "clear_stock", "stock_event", eventId, JSON.stringify(input), now, input.actor);
    if (!input.keepVisible) {
      const allWarehouses = sqlite.prepare("SELECT COALESCE(SUM(quantity_change),0) quantity FROM stock_events WHERE store_id=? AND item_id=?").get(input.storeId, input.itemId) as { quantity: number };
      if (allWarehouses.quantity > 0.000001) throw new Error("该商品在其他仓库仍有库存，请先清理其他仓库后再隐藏");
      sqlite.prepare("UPDATE items SET active=0 WHERE store_id=? AND id=?").run(input.storeId, input.itemId);
      sqlite.prepare("INSERT INTO audit_logs (id,store_id,action,entity_type,entity_id,payload_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)")
        .run(randomUUID(), input.storeId, "deactivate_item_after_cleanup", "item", input.itemId, JSON.stringify({ sku: item.sku }), now, input.actor);
    }
    return { eventId, quantity: balance.quantity, stockUom: item.stockUom, hidden: !input.keepVisible };
  })();
  return result;
}

export type ItemInput = { storeId: string; sku: string; name: string; specification?: string; category: string; purchaseUom: string; stockUom: string; unitsPerPurchase: number; unitNetContent: number; contentUom: string; purchasePriceCents: number; minimumQty: number; warningDays?: number; targetDays?: number; replenishmentFactor?: number; actor: string; role: string };

export async function createItem(input: ItemInput) {
  await ready();
  return sqlite.transaction(() => createItemInTransaction(input))();
}

/** Synchronous write primitive for all-or-nothing document imports. */
export function createItemInTransaction(input: ItemInput) {
  if (!['owner','storekeeper'].includes(input.role)) throw new Error("当前角色无商品建档权限");
  const id = randomUUID();
  const now = new Date().toISOString();
  const warningDays = input.warningDays ?? 15;
  const targetDays = input.targetDays ?? 30;
  const replenishmentFactor = input.replenishmentFactor ?? 1.2;
  const existingSkus = sqlite.prepare("SELECT sku FROM items WHERE store_id=?").all(input.storeId) as { sku: string }[];
  const sku = input.sku.trim().toUpperCase() || nextSkuForName(input.name, existingSkus.map((item) => item.sku));
  try {
    sqlite.prepare("INSERT INTO items (id,store_id,booth_id,sku,name,specification,category,purchase_uom,stock_uom,units_per_purchase,unit_net_content,content_uom,purchase_price_cents,minimum_qty,warning_days,target_days,replenishment_factor,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, input.storeId, null, sku, input.name.trim(), input.specification?.trim() ?? "", input.category.trim(), input.purchaseUom.trim(), input.stockUom.trim(), input.unitsPerPurchase, input.unitNetContent, input.contentUom.trim(), input.purchasePriceCents, input.minimumQty, warningDays, targetDays, replenishmentFactor, now, input.actor);
    sqlite.prepare(`INSERT INTO category_replenishment_settings (store_id,name,warning_days,target_days,factor,updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(store_id,name) DO UPDATE SET warning_days=excluded.warning_days,target_days=excluded.target_days,factor=excluded.factor,updated_at=excluded.updated_at`)
      .run(input.storeId, input.category.trim(), warningDays, targetDays, replenishmentFactor, now);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) throw new Error("该商品 SKU 已存在");
    throw error;
  }
  sqlite.prepare("INSERT INTO audit_logs (id,store_id,action,entity_type,entity_id,payload_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)").run(randomUUID(), input.storeId, "create_item", "item", id, JSON.stringify(input), now, input.actor);
  return { id, sku };
}

export async function updateItem(input: ItemInput & { id: string }) {
  await ready();
  if (!['owner','storekeeper'].includes(input.role)) throw new Error("当前角色无商品修改权限");
  const item = sqlite.prepare("SELECT id,purchase_uom purchaseUom,stock_uom stockUom,units_per_purchase unitsPerPurchase FROM items WHERE store_id=? AND id=?").get(input.storeId, input.id) as { id: string; purchaseUom: string; stockUom: string; unitsPerPurchase: number } | undefined;
  if (!item) throw new Error("商品不存在。");
  const now = new Date().toISOString();
  const warningDays = input.warningDays ?? 15;
  const targetDays = input.targetDays ?? 30;
  const replenishmentFactor = input.replenishmentFactor ?? 1.2;
  try {
    sqlite.transaction(() => {
      sqlite.prepare("UPDATE items SET sku=?,name=?,specification=?,category=?,purchase_uom=?,stock_uom=?,units_per_purchase=?,unit_net_content=?,content_uom=?,purchase_price_cents=?,minimum_qty=?,warning_days=?,target_days=?,replenishment_factor=? WHERE store_id=? AND id=?")
        .run(input.sku.trim().toUpperCase(), input.name.trim(), input.specification?.trim() ?? "", input.category.trim(), input.purchaseUom.trim(), input.stockUom.trim(), input.unitsPerPurchase, input.unitNetContent, input.contentUom.trim(), input.purchasePriceCents, input.minimumQty, warningDays, targetDays, replenishmentFactor, input.storeId, input.id);
      sqlite.prepare(`INSERT INTO category_replenishment_settings (store_id,name,warning_days,target_days,factor,updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(store_id,name) DO UPDATE SET warning_days=excluded.warning_days,target_days=excluded.target_days,factor=excluded.factor,updated_at=excluded.updated_at`)
        .run(input.storeId, input.category.trim(), warningDays, targetDays, replenishmentFactor, now);
      // 仅在旧、新换算都是 1:1 时同步历史单据的单位文字。数量和单价绝不自动换算，
      // 避免把“总价误填为单价”的问题掩盖掉；需要时仍由用户逐条修改采购单价。
      if (item.unitsPerPurchase === 1 && input.unitsPerPurchase === 1) {
        sqlite.prepare("UPDATE stock_events SET input_uom=? WHERE store_id=? AND item_id=? AND input_uom=?")
          .run(input.purchaseUom.trim(), input.storeId, input.id, item.purchaseUom);
        if (item.stockUom !== item.purchaseUom) {
          sqlite.prepare("UPDATE stock_events SET input_uom=? WHERE store_id=? AND item_id=? AND input_uom=?")
            .run(input.stockUom.trim(), input.storeId, input.id, item.stockUom);
        }
      }
      sqlite.prepare("INSERT INTO audit_logs (id,store_id,action,entity_type,entity_id,payload_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)")
        .run(randomUUID(), input.storeId, "update_item", "item", input.id, JSON.stringify(input), now, input.actor);
    })();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) throw new Error("该商品 SKU 已存在");
    throw error;
  }
  return { id: input.id };
}

export type ProductMarginInput = { storeId: string; period: string; category: string; productName: string; uom: string; sellingPriceCents: number; purchasePriceCents: number; auxiliaryCostCents: number; portionQty: number; yieldRate: number; freightCents: number; note?: string; actor: string; role: string };

export async function saveProductMargin(input: ProductMarginInput) {
  await ready();
  if (!['owner','finance'].includes(input.role)) throw new Error("当前角色无毛利录入权限");
  const result = calculateProductMargin(input);
  const id = randomUUID(); const now = new Date().toISOString();
  sqlite.prepare(`INSERT INTO product_margins (id,store_id,period,category,product_name,uom,selling_price_cents,purchase_price_cents,auxiliary_cost_cents,portion_qty,yield_rate,freight_cents,cost_cents,gross_profit_cents,gross_margin,calculation_mode,source_type,source_batch_id,note,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(store_id,period,category,product_name) DO UPDATE SET uom=excluded.uom,selling_price_cents=excluded.selling_price_cents,purchase_price_cents=excluded.purchase_price_cents,auxiliary_cost_cents=excluded.auxiliary_cost_cents,portion_qty=excluded.portion_qty,yield_rate=excluded.yield_rate,freight_cents=excluded.freight_cents,cost_cents=excluded.cost_cents,gross_profit_cents=excluded.gross_profit_cents,gross_margin=excluded.gross_margin,source_type='manual',note=excluded.note`)
    .run(id, input.storeId, input.period, input.category.trim(), input.productName.trim(), input.uom.trim(), input.sellingPriceCents, input.purchasePriceCents, input.auxiliaryCostCents, input.portionQty, input.yieldRate, input.freightCents, result.costCents, result.grossProfitCents, result.grossMargin, "standard", "manual", null, input.note ?? null, now, input.actor);
  sqlite.prepare("INSERT INTO audit_logs (id,store_id,action,entity_type,entity_id,payload_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)").run(randomUUID(), input.storeId, "save_product_margin", "product_margin", id, JSON.stringify(input), now, input.actor);
  return { id, ...result };
}

export async function closePeriod(period: string, actor: string, role: string) {
  await ready();
  if (!['owner','finance'].includes(role)) throw new Error("当前角色无月结权限");
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT INTO period_closes (id,store_id,period,status,closed_at,closed_by,note,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(store_id,period) DO UPDATE SET status='closed',closed_at=excluded.closed_at,closed_by=excluded.closed_by,note=excluded.note`)
    .run(randomUUID(), STORE_ID, period, "closed", now, actor, "经营数据已复核锁定", now, actor);
  sqlite.prepare("INSERT INTO audit_logs (id,store_id,action,entity_type,entity_id,payload_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)").run(randomUUID(), STORE_ID, "period_close", "period", period, JSON.stringify({ period }), now, actor);
  return { period, status: "closed", closedAt: now };
}
