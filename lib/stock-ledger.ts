import { randomUUID } from "node:crypto";
import { sqlite } from "./db";
import { convertToStockUnit, outgoingInventoryValue } from "./domain/inventory";
export { outgoingInventoryValue } from "./domain/inventory";

export type StockLedgerInput = {
  storeId: string; itemId: string; warehouseId: string; eventType: string;
  businessDate: string; quantity: number; quantityUom: "purchase" | "stock";
  unitCostCents?: number; note?: string; actor: string; role: string;
  sourceType?: string; sourceId?: string; requestId?: string;
  // 仅服务端采购单据使用原收货快照，不从普通 API 接收。
  conversionSnapshot?: { factor: number; inputUom: string };
};

export function assertStockPeriodOpen(storeId: string, date: string, allowAdjustment = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) !== date) throw new Error("业务日期不正确");
  const closed = sqlite.prepare("SELECT status FROM period_closes WHERE store_id=? AND period=?").get(storeId,date.slice(0,7)) as { status: string } | undefined;
  if (closed?.status === "closed" && !allowAdjustment) throw new Error("该月份已结账，不能改写库存；请通过当期调整单修正。");
}

export function assertStockWarehouse(storeId: string, warehouseId: string) {
  if (!sqlite.prepare("SELECT id FROM warehouses WHERE id=? AND store_id=?").get(warehouseId,storeId)) throw new Error("库存仓库不存在或不属于当前门店");
}

export function stockBalance(storeId: string, itemId: string, warehouseId: string) {
  const row = sqlite.prepare("SELECT COALESCE(SUM(quantity_change),0) quantity, COALESCE(SUM(total_cost_cents),0) valueCents FROM stock_events WHERE store_id=? AND item_id=? AND warehouse_id=?").get(storeId,itemId,warehouseId) as { quantity: number; valueCents: number };
  if (!Number.isFinite(row.quantity) || !Number.isSafeInteger(row.valueCents) || row.quantity < -1e-9 || row.valueCents < 0 || (Math.abs(row.quantity) < 1e-9 && row.valueCents !== 0)) throw new Error("现有库存数量或金额异常，请先核对历史账本并通过明确调整修正；系统未自动改写旧账。");
  return { ...row, quantity: Math.abs(row.quantity) < 1e-9 ? 0 : row.quantity };
}

/** 同步业务写入边界：调用方必须已 ready，并用 sqlite.transaction 包住整批。 */
export function appendStockEventInTransaction(input: StockLedgerInput) {
  if (!sqlite.inTransaction) throw new Error("库存写入必须在事务中执行");
  if (!["owner","storekeeper"].includes(input.role)) throw new Error("当前角色无库存作业权限");
  const outbound = ["sale","return","transfer_out","issue","waste"].includes(input.eventType);
  if (!outbound && !["purchase","transfer_in","issue_return","adjustment"].includes(input.eventType)) throw new Error("库存业务类型不正确");
  assertStockPeriodOpen(input.storeId,input.businessDate,input.eventType === "adjustment" && input.sourceType !== "opening");
  assertStockWarehouse(input.storeId,input.warehouseId);
  const item=sqlite.prepare("SELECT purchase_uom,stock_uom,units_per_purchase,purchase_price_cents,active FROM items WHERE store_id=? AND id=?").get(input.storeId,input.itemId) as { purchase_uom:string; stock_uom:string; units_per_purchase:number; purchase_price_cents:number; active:number } | undefined;
  if (!item) throw new Error("商品不存在");
  if (!item.active) throw new Error("该商品已停用，不能再录入库存作业。");
  const factor=input.conversionSnapshot?.factor ?? (input.quantityUom === "purchase" ? item.units_per_purchase : 1);
  const balance=stockBalance(input.storeId,input.itemId,input.warehouseId);
  const averageCostCents=balance.quantity ? balance.valueCents / balance.quantity : 0;
  const fallbackCost=item.purchase_price_cents > 0 ? item.purchase_price_cents * factor / item.units_per_purchase : averageCostCents*factor;
  const providedCost=input.eventType === "purchase" || input.sourceType === "opening" ? input.unitCostCents ?? fallbackCost : undefined;
  const converted=convertToStockUnit({quantity:input.quantity,quantityUom:"purchase",unitsPerPurchase:factor,unitCostCents:providedCost});
  const amount=outbound ? outgoingInventoryValue(balance,converted.stockQuantity) : Math.round(providedCost == null ? converted.stockQuantity * averageCostCents : input.quantity * providedCost);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("库存金额超出有效范围");
  const unitCostCents=outbound ? averageCostCents : converted.stockUnitCostCents ?? averageCostCents;
  const id=randomUUID(); const timestamp=new Date().toISOString();
  const inputUom=input.conversionSnapshot?.inputUom ?? (input.quantityUom === "purchase" ? item.purchase_uom : item.stock_uom);
  const totalCostCents=outbound ? -amount : amount;
  sqlite.prepare("INSERT INTO stock_events (id,store_id,item_id,warehouse_id,event_type,business_date,quantity_change,input_quantity,input_uom,conversion_factor,input_unit_cost_cents,unit_cost_cents,total_cost_cents,source_type,source_id,note,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id,input.storeId,input.itemId,input.warehouseId,input.eventType,input.businessDate,outbound ? -converted.stockQuantity : converted.stockQuantity,input.quantity,inputUom,factor,providedCost ?? null,unitCostCents,totalCostCents,input.sourceType ?? (input.eventType === "adjustment" ? "adjustment" : "manual"),input.sourceId ?? id,input.note ?? null,timestamp,input.actor);
  sqlite.prepare("INSERT INTO audit_logs (id,store_id,action,entity_type,entity_id,payload_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)")
    .run(randomUUID(),input.storeId,"append_stock_event","stock_event",id,JSON.stringify(input),timestamp,input.actor);
  return { id,averageCostCents:unitCostCents,stockQuantity:converted.stockQuantity,stockUom:item.stock_uom,conversionFactor:factor,totalCostCents };
}
