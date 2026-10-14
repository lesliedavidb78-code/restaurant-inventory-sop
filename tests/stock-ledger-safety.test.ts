import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { ensureSchema, sqlite } from "@/lib/db";
import { appendStockEvent, clearStockAndMaybeDeactivate, getDashboard } from "@/lib/services";
import { createPurchaseOrder, createSupplier, getPurchasing, receivePurchase, returnPurchase } from "@/lib/purchase";
import { localStore } from "@/lib/local-store";
import { DELETE, PATCH } from "@/app/api/stock-records/route";
import { POST as stockPost } from "@/app/api/stock/route";
import { commitOpeningStock } from "@/lib/inventory-reports";

let warehouseId: string; let itemId: string;
const ctx = { ...localStore, role: "owner", actor: "ledger-regression" };
const date = "2026-10-13";
const post = (quantity: number, unitCostCents: number, eventType = "purchase", extra = {}) => appendStockEvent({ ...ctx,itemId,warehouseId,eventType,businessDate:date,quantity,quantityUom:"stock",unitCostCents,...extra });
const balance = async () => (await getDashboard(ctx.storeId,"2026-10")).stock.find(x => x.item_id === itemId && x.warehouse_id === warehouseId)!;
const req = (method: string, data: unknown) => new NextRequest("http://localhost/api/stock-records", { method,headers:{"content-type":"application/json"},body:JSON.stringify(data) });
async function purchase(quantity: number, unitCostCents: number) {
  const supplier=await createSupplier({...ctx,name:randomUUID()});
  const order=await createPurchaseOrder({...ctx,supplierId:supplier.id,businessDate:date,lines:[{itemId,quantity,quantityUom:"stock",unitCostCents}]});
  const line=(await getPurchasing(ctx.storeId)).lines.find((x:any)=>x.orderId===order.id) as any;
  return receivePurchase({...ctx,orderLineId:line.id,warehouseId,businessDate:date,quantity,unitCostCents});
}
describe("共享库存写入：账本守恒与历史保护", () => {
  beforeEach(async () => {
    if (!process.env.RESTAURANT_DATA_DIR?.includes(".review-temp")) throw new Error("必须使用 .review-temp 隔离账本");
    ensureSchema(); warehouseId=randomUUID(); itemId=randomUUID();
    // 启动 seed 后建立独立商品/仓库，真实 route 使用同一 localStore。
    await getDashboard(ctx.storeId);
    sqlite.prepare("INSERT INTO warehouses (id,store_id,name,type,created_at,created_by) VALUES (?,?,?,?,?,?)").run(warehouseId,ctx.storeId,"隔离仓","main",date,"test");
    sqlite.prepare("INSERT INTO items (id,store_id,sku,name,category,purchase_uom,stock_uom,units_per_purchase,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)").run(itemId,ctx.storeId,itemId,"隔离原料","test","袋","g",1000,date,"test");
    sqlite.prepare("DELETE FROM period_closes WHERE store_id=? AND period='2026-10'").run(ctx.storeId);
  });
  it("35 元整袋录为 1000g，分次全出与库存清理都没有金额尾差", async () => {
    await post(1,3500,"purchase",{quantityUom:"purchase"});
    expect(await balance()).toMatchObject({quantity:1000,value_cents:3500,averageCostCents:3.5});
    await post(333,0,"issue"); expect(await balance()).toMatchObject({quantity:667,value_cents:2334});
    await post(667,0,"issue"); expect(await balance()).toMatchObject({quantity:0,value_cents:0});
    await post(1,100,"purchase",{quantityUom:"purchase"});
    await clearStockAndMaybeDeactivate({...ctx,itemId,warehouseId,businessDate:date,keepVisible:true});
    expect(await balance()).toMatchObject({quantity:0,value_cents:0});
  });
  it("低价与高价混合后退回高价原单，退款和库存价值分开且全退清零", async () => {
    await purchase(1,100); const expensive=await purchase(1,1000); await post(1,0,"issue");
    const result=await returnPurchase({...ctx,receiptId:expensive.receiptId,businessDate:date,quantity:1});
    expect(await balance()).toMatchObject({quantity:0,value_cents:0,averageCostCents:0});
    expect(result).toMatchObject({refundCents:1000,inventoryCostCents:550,priceVarianceCents:450});
  });
  it("已有后续领用时拒绝删改早期入库；无变化保存不重算采购退货", async () => {
    const original=await post(10,100); await post(8,0,"issue");
    expect((await DELETE(req("DELETE",{id:original.id}))).status).toBe(400);
    expect((await PATCH(req("PATCH",{id:original.id,businessDate:date,quantity:1,quantityUom:"stock",unitCostCents:100}))).status).toBe(400);
    expect(await balance()).toMatchObject({quantity:2,value_cents:200});
    const receipt=await purchase(10,300); await returnPurchase({...ctx,receiptId:receipt.receiptId,businessDate:date,quantity:5});
    const before=await balance();
    const saved=await PATCH(req("PATCH",{id:original.id,businessDate:date,quantity:10,quantityUom:"stock",unitCostCents:100}));
    expect(saved.status).toBe(200); expect(await saved.json()).toMatchObject({unchanged:true});
    expect(await balance()).toMatchObject({quantity:before.quantity,value_cents:before.value_cents});
  });
  it("关闭月份拒绝收货、退货、期初、历史删改及目标日期修改", async () => {
    const original=await post(10,100); const receipt=await purchase(2,200);
    const supplier=await createSupplier({...ctx,name:randomUUID()});
    const order=await createPurchaseOrder({...ctx,supplierId:supplier.id,businessDate:date,lines:[{itemId,quantity:1,quantityUom:"stock",unitCostCents:100}]});
    const line=(await getPurchasing(ctx.storeId)).lines.find((x:any)=>x.orderId===order.id) as any;
    sqlite.prepare("INSERT INTO period_closes (id,store_id,period,status,created_at,created_by) VALUES (?,?,?,?,?,?)").run(randomUUID(),ctx.storeId,"2026-10","closed",date,"test");
    await expect(receivePurchase({...ctx,orderLineId:line.id,warehouseId,businessDate:date,quantity:1,unitCostCents:100})).rejects.toThrow("结账");
    await expect(returnPurchase({...ctx,receiptId:receipt.receiptId,businessDate:date,quantity:1})).rejects.toThrow("结账");
    await expect(commitOpeningStock({...ctx,warehouseId,businessDate:date,lines:[{itemId,quantity:1,quantityUom:"stock",unitCostCents:100}]})).rejects.toThrow("结账");
    expect((await DELETE(req("DELETE",{id:original.id}))).status).toBe(400);
    expect((await PATCH(req("PATCH",{id:original.id,businessDate:date,quantity:10,quantityUom:"stock",unitCostCents:100}))).status).toBe(400);
    expect(await balance()).toMatchObject({quantity:12,value_cents:1400});
    await expect(post(1,100)).rejects.toThrow("结账");
    await post(1,0,"adjustment"); expect((await balance()).quantity).toBe(13);
  });
  it("相同库存请求只入账一次；更改同请求内容拒绝，跨店/不存在仓库拒绝", async () => {
    const body={itemId,warehouseId,eventType:"purchase",businessDate:date,quantity:10,quantityUom:"stock",unitCostCents:100,requestId:randomUUID()};
    const first=await stockPost(req("POST",body)); const second=await stockPost(req("POST",body));
    expect(first.status).toBe(200); expect(second.status).toBe(200); expect(await first.json()).toEqual(await second.json());
    expect((await stockPost(req("POST",{...body,quantity:11}))).status).toBe(400);
    expect((await stockPost(req("POST",{...body,requestId:randomUUID(),warehouseId:"missing-warehouse"}))).status).toBe(400);
    const otherStore=randomUUID();const foreignWarehouse=randomUUID();
    sqlite.prepare("INSERT INTO stores (id,name,code,created_at,created_by) VALUES (?,?,?,?,?)").run(otherStore,"另一店",otherStore,date,"test");
    sqlite.prepare("INSERT INTO warehouses (id,store_id,name,type,created_at,created_by) VALUES (?,?,?,?,?,?)").run(foreignWarehouse,otherStore,"另一店仓","main",date,"test");
    expect((await stockPost(req("POST",{...body,requestId:randomUUID(),warehouseId:foreignWarehouse}))).status).toBe(400);
    expect(await balance()).toMatchObject({quantity:10,value_cents:1000});
  });
  it("3 分金额分成六次半单位退货，累计退款不超过原单并最终精确清零", async () => {
    const receipt=await purchase(3,1);let refunded=0;
    for(let i=0;i<6;i++){const result=await returnPurchase({...ctx,receiptId:receipt.receiptId,businessDate:date,quantity:0.5}); refunded+=result.refundCents;}
    expect(refunded).toBe(3);expect(await balance()).toMatchObject({quantity:0,value_cents:0});
  });
  it("未填单价时以采购默认价换算当前录入单位，不把整袋价当每克价", async () => {
    sqlite.prepare("UPDATE items SET purchase_price_cents=3500 WHERE id=?").run(itemId);
    await appendStockEvent({...ctx,itemId,warehouseId,eventType:"purchase",businessDate:date,quantity:1000,quantityUom:"stock"});
    expect(await balance()).toMatchObject({quantity:1000,value_cents:3500,averageCostCents:3.5});
  });
  it("更改商品包装后编辑原采购数量，仍沿用原单换算快照", async () => {
    const original=await post(1,3500,"purchase",{quantityUom:"purchase"});
    sqlite.prepare("UPDATE items SET units_per_purchase=2000 WHERE id=?").run(itemId);
    const edited=await PATCH(req("PATCH",{id:original.id,businessDate:date,quantity:2,quantityUom:"purchase",unitCostCents:3500}));
    expect(edited.status).toBe(200); expect(await balance()).toMatchObject({quantity:2000,value_cents:7000,averageCostCents:3.5});
  });
});
