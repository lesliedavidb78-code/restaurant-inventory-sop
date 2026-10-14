import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ensureSchema, sqlite } from "@/lib/db";
import { confirmStockCount, createStockCount, getStockCount, getReconciliation, rebaseStockCount, saveStockCountLines } from "@/lib/reconciliation";
import { createPurchaseOrder, createSupplier, getPurchasing, receivePurchase, returnPurchase } from "@/lib/purchase";
import { businessDate } from "@/lib/domain/business-date";

let storeId: string; let warehouseId: string; let itemId: string;
const date = "2026-10-11";
function event(quantity: number) {
  sqlite.prepare("INSERT INTO stock_events (id,store_id,item_id,warehouse_id,event_type,business_date,quantity_change,unit_cost_cents,total_cost_cents,source_type,source_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(randomUUID(),storeId,itemId,warehouseId,"adjustment",date,quantity,100,quantity*100,"manual",randomUUID(),new Date().toISOString(),"test");
}
function balance() { return (sqlite.prepare("SELECT SUM(quantity_change) q FROM stock_events WHERE store_id=? AND item_id=?").get(storeId,itemId) as { q: number }).q; }
function count() { return createStockCount({ storeId,warehouseId,businessDate:date,mode:"open",note:"",actor:"test" }).id; }
describe("隔离账本：盘点与采购对抗回归", () => {
  beforeEach(() => {
    if (!process.env.RESTAURANT_DATA_DIR?.includes(".review-temp")) throw new Error("本测试仅允许在 .review-temp 隔离账本运行，禁止使用用户数据库。");
    ensureSchema(); storeId=randomUUID(); warehouseId=randomUUID(); itemId=randomUUID();
    sqlite.prepare("INSERT INTO stores (id,name,code,created_at,created_by) VALUES (?,?,?,?,?)").run(storeId,"回归门店",storeId,date,"test");
    sqlite.prepare("INSERT INTO warehouses (id,store_id,name,type,created_at,created_by) VALUES (?,?,?,?,?,?)").run(warehouseId,storeId,"测试仓","main",date,"test");
    sqlite.prepare("INSERT INTO items (id,store_id,sku,name,category,purchase_uom,stock_uom,units_per_purchase,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)").run(itemId,storeId,"BEEF","牛肉","肉类","件","袋",10,date,"test");
    event(10);
  });
  it("后续出库后拒绝旧快照；显式重新核对后不再重复扣减", () => {
    const id=count(); event(-3);
    expect(() => confirmStockCount({ storeId,countId:id,actor:"test",lines:[{itemId,countedQuantity:7,reason:""}] })).toThrow("库存流水或商品单位已变化");
    expect(balance()).toBe(7);
    saveStockCountLines({storeId,countId:id,lines:[{itemId,countedQuantity:7,reason:""}]}); rebaseStockCount({storeId,countId:id});
    expect(confirmStockCount({storeId,countId:id,actor:"test"})).toEqual({adjusted:0}); expect(balance()).toBe(7);
  });
  it("净变化为零的入出库也被识别，不可绕过快照校验", () => { const id=count(); event(3); event(-3); expect(() => confirmStockCount({storeId,countId:id,actor:"test",lines:[{itemId,countedQuantity:8,reason:""}]})).toThrow("库存流水或商品单位已变化"); expect(balance()).toBe(10); });
  it("第 2 行无效时第 1 行不落库；重复商品也不落库", () => {
    const id=count(); const line={itemId,countedQuantity:8,reason:""};
    expect(() => saveStockCountLines({storeId,countId:id,lines:[line,{...line,itemId:"outside"}]})).toThrow("未保存任何修改");
    expect((getStockCount(storeId,id).lines[0] as any).countedQuantity).toBeNull();
    expect(() => saveStockCountLines({storeId,countId:id,lines:[line,line]})).toThrow("重复"); expect((getStockCount(storeId,id).lines[0] as any).countedQuantity).toBeNull();
  });
  it("确认自动保存当前输入，只确认一次；清空可恢复未盘状态", () => {
    const id=count(); saveStockCountLines({storeId,countId:id,lines:[{itemId,countedQuantity:9,reason:""}]}); saveStockCountLines({storeId,countId:id,lines:[{itemId,countedQuantity:null,reason:""}]});
    expect((getStockCount(storeId,id).lines[0] as any).countedQuantity).toBeNull();
    confirmStockCount({storeId,countId:id,actor:"test",lines:[{itemId,countedQuantity:8,reason:"损耗"}]}); expect(balance()).toBe(8);
    expect(() => confirmStockCount({storeId,countId:id,actor:"test"})).toThrow("已确认"); expect(balance()).toBe(8);
  });
  it("旧草稿无快照时安全拒绝，支持显式重新核对", () => { const id=count(); sqlite.prepare("UPDATE stock_counts SET snapshot_hash='' WHERE id=?").run(id); expect(() => confirmStockCount({storeId,countId:id,actor:"test"})).toThrow("重新核对"); rebaseStockCount({storeId,countId:id}); confirmStockCount({storeId,countId:id,actor:"test",lines:[{itemId,countedQuantity:10,reason:""}]}); expect(balance()).toBe(10); });
  it("盘点历史超过二十条仍完整返回，页码不再只覆盖截断子集", () => { for(let i=0;i<25;i++) count(); expect(getReconciliation(storeId).counts).toHaveLength(25); });
  it("重复提交采购不重复建单；原包装修改后退货仍扣十袋", async () => {
    const ctx={storeId,actor:"test",role:"owner"}; const supplier=await createSupplier({...ctx,name:"供应商"});
    const input={...ctx,requestId:randomUUID(),supplierId:supplier.id,businessDate:date,lines:[{itemId,quantity:1,quantityUom:"purchase" as const,unitCostCents:350}]};
    const order=await createPurchaseOrder(input); expect(await createPurchaseOrder(input)).toEqual(order);
    const line=(await getPurchasing(storeId)).lines[0] as any;
    const receiptInput={...ctx,requestId:randomUUID(),orderLineId:line.id,warehouseId,businessDate:date,quantity:1,unitCostCents:350};
    const receipt=await receivePurchase(receiptInput); expect(await receivePurchase(receiptInput)).toEqual(receipt); expect(balance()).toBe(20);
    sqlite.prepare("UPDATE items SET units_per_purchase=20 WHERE id=?").run(itemId);
    const returnInput={...ctx,requestId:randomUUID(),receiptId:receipt.receiptId,businessDate:date,quantity:1};
    const returned=await returnPurchase(returnInput); expect(balance()).toBe(10); expect(await returnPurchase(returnInput)).toEqual(returned); expect(balance()).toBe(10);
  });
  it("北京时间凌晨使用当日而非 UTC 前一天", () => { expect(businessDate(new Date("2026-10-10T17:00:00Z"))).toBe("2026-10-11"); });
});
