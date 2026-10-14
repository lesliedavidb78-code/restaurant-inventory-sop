import { randomUUID } from "node:crypto";
import { ready } from "./services";
import { sqlite } from "./db";
import { calculateReceiptBalance, convertReceiptReturn } from "./domain/purchase-flow";
import { idempotentMutation } from "./mutation-idempotency";
import { appendStockEventInTransaction, assertStockPeriodOpen, assertStockWarehouse } from "./stock-ledger";

type Context = { storeId: string; actor: string; role: string; requestId?: string };
const now = () => new Date().toISOString();
const allow = (role: string) => { if (!["owner", "storekeeper"].includes(role)) throw new Error("当前角色无采购管理权限"); };

export async function getPurchasing(storeId: string) {
  await ready();
  const suppliers = sqlite.prepare("SELECT id,name,COALESCE(contact,'') contact FROM suppliers WHERE store_id=? ORDER BY name").all(storeId);
  const orders = sqlite.prepare(`SELECT o.id,o.order_no orderNo,o.business_date businessDate,o.expected_date expectedDate,o.status,o.note,s.name supplierName,
    COALESCE(SUM(l.ordered_quantity),0) orderedQuantity,COALESCE(SUM(l.received_quantity),0) receivedQuantity,COALESCE(SUM(l.returned_quantity),0) returnedQuantity
    FROM purchase_orders o JOIN suppliers s ON s.id=o.supplier_id LEFT JOIN purchase_order_lines l ON l.order_id=o.id WHERE o.store_id=? GROUP BY o.id ORDER BY o.created_at DESC`).all(storeId);
  const items = sqlite.prepare("SELECT id,name,sku,purchase_uom purchaseUom,stock_uom stockUom,units_per_purchase unitsPerPurchase,purchase_price_cents purchasePriceCents FROM items WHERE store_id=? AND active=1 ORDER BY name").all(storeId);
  const lines = sqlite.prepare(`SELECT l.id,l.order_id orderId,l.ordered_quantity orderedQuantity,l.received_quantity receivedQuantity,l.returned_quantity returnedQuantity,l.quantity_uom quantityUom,l.unit_cost_cents unitCostCents,i.name itemName,i.sku,o.order_no orderNo
    FROM purchase_order_lines l JOIN purchase_orders o ON o.id=l.order_id JOIN items i ON i.id=l.item_id WHERE o.store_id=? ORDER BY o.created_at DESC`).all(storeId);
  const receipts = sqlite.prepare(`SELECT r.id,r.order_line_id orderLineId,r.business_date businessDate,r.quantity,r.quantity_uom quantityUom,r.unit_cost_cents unitCostCents,r.original_total_cents originalTotalCents,i.name itemName,COALESCE((SELECT SUM(quantity) FROM purchase_returns WHERE receipt_id=r.id),0) returnedQuantity,COALESCE((SELECT SUM(refund_cents) FROM purchase_returns WHERE receipt_id=r.id),0) refundCents,COALESCE((SELECT SUM(inventory_cost_cents) FROM purchase_returns WHERE receipt_id=r.id),0) returnedInventoryCostCents,COALESCE((SELECT SUM(price_variance_cents) FROM purchase_returns WHERE receipt_id=r.id),0) priceVarianceCents
    FROM purchase_receipts r JOIN purchase_order_lines l ON l.id=r.order_line_id JOIN purchase_orders o ON o.id=r.order_id JOIN items i ON i.id=l.item_id WHERE o.store_id=? ORDER BY r.created_at DESC`).all(storeId);
  return { suppliers, orders, items, lines, receipts };
}

export async function createSupplier(input: Context & { name: string; contact?: string }) {
  await ready(); allow(input.role); const id = randomUUID(); const timestamp = now();
  sqlite.prepare("INSERT INTO suppliers (id,store_id,name,contact,created_at,created_by) VALUES (?,?,?,?,?,?)").run(id, input.storeId, input.name.trim(), input.contact?.trim() || null, timestamp, input.actor);
  return { id };
}

export async function createPurchaseOrder(input: Context & { supplierId: string; businessDate: string; expectedDate?: string; note?: string; lines: { itemId: string; quantity: number; quantityUom: "purchase" | "stock"; unitCostCents: number }[] }) {
  await ready(); allow(input.role);
  if (!input.lines.length) throw new Error("请至少填写一条采购商品");
  const timestamp = now(); const id = randomUUID(); const orderNo = `PO-${input.businessDate.replaceAll("-", "")}-${id.slice(0, 6).toUpperCase()}`;
  return idempotentMutation(input.storeId, input.requestId, "purchase_order", input, () => {
    const supplier = sqlite.prepare("SELECT id FROM suppliers WHERE id=? AND store_id=?").get(input.supplierId, input.storeId); if (!supplier) throw new Error("供应商不存在");
    sqlite.prepare("INSERT INTO purchase_orders (id,store_id,supplier_id,order_no,business_date,expected_date,status,note,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id,input.storeId,input.supplierId,orderNo,input.businessDate,input.expectedDate || null,"draft",input.note?.trim() || "",timestamp,input.actor);
    const insert = sqlite.prepare("INSERT INTO purchase_order_lines (id,order_id,item_id,ordered_quantity,received_quantity,returned_quantity,quantity_uom,unit_cost_cents,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)");
    for (const line of input.lines) { if (!Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unitCostCents) || line.unitCostCents < 0) throw new Error("采购数量和单价不正确"); if (!sqlite.prepare("SELECT id FROM items WHERE id=? AND store_id=? AND active=1").get(line.itemId, input.storeId)) throw new Error("采购商品不存在或已停用"); insert.run(randomUUID(),id,line.itemId,line.quantity,0,0,line.quantityUom,line.unitCostCents,timestamp,input.actor); }
    return { id, orderNo };
  });
}

export async function receivePurchase(input: Context & { orderLineId: string; warehouseId: string; businessDate: string; quantity: number; unitCostCents: number }) {
  await ready(); allow(input.role); if (!Number.isFinite(input.quantity) || input.quantity <= 0 || !Number.isFinite(input.unitCostCents) || input.unitCostCents < 0) throw new Error("收货数量或单价不正确");
  const timestamp = now(); const receiptId = randomUUID();
  return idempotentMutation(input.storeId, input.requestId, "purchase_receive", input, () => {
    assertStockPeriodOpen(input.storeId,input.businessDate);
    assertStockWarehouse(input.storeId,input.warehouseId);
    const line = sqlite.prepare(`SELECT l.*,o.id orderId,o.store_id storeId,o.status,i.purchase_uom purchaseUom,i.stock_uom stockUom,i.units_per_purchase unitsPerPurchase,i.purchase_price_cents defaultCost
      FROM purchase_order_lines l JOIN purchase_orders o ON o.id=l.order_id JOIN items i ON i.id=l.item_id WHERE l.id=?`).get(input.orderLineId) as any;
    if (!line || line.storeId !== input.storeId) throw new Error("采购明细不存在"); if (line.status === "cancelled") throw new Error("已取消采购单不能收货");
    const balance = calculateReceiptBalance({ orderedQuantity: line.ordered_quantity, receivedQuantity: line.received_quantity, returnedQuantity: line.returned_quantity });
    if (input.quantity > balance.pendingQuantity + 1e-9) throw new Error(`本次收货不能超过待收 ${balance.pendingQuantity} ${line.quantity_uom}`);
    const event=appendStockEventInTransaction({...input,itemId:line.item_id,eventType:"purchase",quantityUom:line.quantity_uom,sourceType:"purchase_receipt",sourceId:receiptId,note:`采购单 ${line.order_id} 收货`});
    sqlite.prepare("INSERT INTO purchase_receipts (id,order_id,order_line_id,warehouse_id,business_date,quantity,quantity_uom,unit_cost_cents,original_total_cents,stock_event_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(receiptId,line.orderId,input.orderLineId,input.warehouseId,input.businessDate,input.quantity,line.quantity_uom,input.unitCostCents,event.totalCostCents,event.id,timestamp,input.actor);
    sqlite.prepare("UPDATE purchase_order_lines SET received_quantity=received_quantity+? WHERE id=?").run(input.quantity,input.orderLineId);
    sqlite.prepare("UPDATE purchase_orders SET status='receiving' WHERE id=? AND status='draft'").run(line.orderId);
    return { receiptId, eventId:event.id };
  });
}

export async function returnPurchase(input: Context & { receiptId: string; businessDate: string; quantity: number; note?: string }) {
  await ready(); allow(input.role); if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error("退货数量必须大于 0"); const timestamp = now(); const id = randomUUID();
  return idempotentMutation(input.storeId, input.requestId, "purchase_return", input, () => {
    assertStockPeriodOpen(input.storeId,input.businessDate);
    const r = sqlite.prepare(`SELECT r.*,l.item_id itemId,e.conversion_factor conversionFactor,e.unit_cost_cents originalStockUnitCost,e.total_cost_cents originalTotalCost,e.input_uom originalInputUom
      FROM purchase_receipts r JOIN purchase_order_lines l ON l.id=r.order_line_id JOIN purchase_orders o ON o.id=r.order_id JOIN stock_events e ON e.id=r.stock_event_id AND e.store_id=o.store_id AND e.item_id=l.item_id WHERE r.id=? AND o.store_id=?`).get(input.receiptId,input.storeId) as any;
    if (!r) throw new Error("原收货记录不存在");
    const returnedForReceipt = sqlite.prepare("SELECT COALESCE(SUM(quantity),0) q,COALESCE(SUM(COALESCE(refund_cents,ROUND(quantity*?))),0) refundedCents FROM purchase_returns WHERE receipt_id=?").get(r.unit_cost_cents,input.receiptId) as {q:number;refundedCents:number};
    if (input.quantity > r.quantity - returnedForReceipt.q + 1e-9) throw new Error("退货数量不能超过该次已收未退数量");
    if (typeof r.originalInputUom !== "string" || !r.originalInputUom.trim()) throw new Error("原收货单位快照缺失，请核对原收货流水。");
    const originalTotal=r.original_total_cents ?? Math.round(r.quantity*r.unit_cost_cents);
    const converted = convertReceiptReturn(input.quantity, { conversionFactor: r.conversionFactor, unitCostCents: r.originalStockUnitCost, totalCostCents: originalTotal, receivedQuantity: r.quantity });
    const event=appendStockEventInTransaction({...input,itemId:r.itemId,warehouseId:r.warehouse_id,eventType:"return",quantityUom:r.quantity_uom,sourceType:"purchase_return",sourceId:id,conversionSnapshot:{factor:converted.conversionFactor,inputUom:r.originalInputUom},note:input.note?.trim() || `退回原收货 ${input.receiptId}`});
    // 商业退款按原收货价，库存转出按现存移动平均值，二者不得混为同一字段。
    const cumulativeRefund=Math.abs(r.quantity-returnedForReceipt.q-input.quantity)<1e-9 ? originalTotal : Math.round(originalTotal*(returnedForReceipt.q+input.quantity)/r.quantity);
    const refundCents=cumulativeRefund-returnedForReceipt.refundedCents;
    const inventoryCostCents=-event.totalCostCents;
    const priceVarianceCents=refundCents-inventoryCostCents;
    if (!Number.isSafeInteger(refundCents) || refundCents < 0) throw new Error("原收货退款金额异常，请核对原单。");
    sqlite.prepare("UPDATE stock_events SET input_unit_cost_cents=? WHERE id=?").run(r.unit_cost_cents,event.id);
    sqlite.prepare("INSERT INTO purchase_returns (id,receipt_id,business_date,quantity,note,stock_event_id,refund_cents,inventory_cost_cents,price_variance_cents,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(id,input.receiptId,input.businessDate,input.quantity,input.note?.trim() || "",event.id,refundCents,inventoryCostCents,priceVarianceCents,timestamp,input.actor);
    sqlite.prepare("UPDATE purchase_order_lines SET returned_quantity=returned_quantity+? WHERE id=?").run(input.quantity,r.order_line_id);
    return { id, eventId:event.id,refundCents,inventoryCostCents,priceVarianceCents };
  });
}
