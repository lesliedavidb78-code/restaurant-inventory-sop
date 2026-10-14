import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sqlite } from "@/lib/db";
import { localStore } from "@/lib/local-store";
import { getDashboard, ready } from "@/lib/services";
import { convertToStockUnit } from "@/lib/domain/inventory";
import { assertStockPeriodOpen, assertStockWarehouse, stockBalance } from "@/lib/stock-ledger";

const editSchema=z.object({id:z.string().min(1),businessDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),quantity:z.number().positive(),quantityUom:z.enum(["purchase","stock"]),unitCostCents:z.number().finite().nonnegative()});
type RecordRow={id:string;rowId:number;itemId:string;warehouseId:string;eventType:string;sourceType:string;businessDate:string;inputQuantity:number|null;inputUom:string|null;conversionFactor:number;inputUnitCostCents:number|null;unitCostCents:number;quantityChange:number;totalCostCents:number;purchaseUom:string;stockUom:string;unitsPerPurchase:number};
function record(id:string) {
  return sqlite.prepare(`SELECT e.rowid rowId,e.id,e.item_id itemId,e.warehouse_id warehouseId,e.event_type eventType,e.source_type sourceType,e.business_date businessDate,
    e.input_quantity inputQuantity,e.input_uom inputUom,e.conversion_factor conversionFactor,e.input_unit_cost_cents inputUnitCostCents,e.unit_cost_cents unitCostCents,e.quantity_change quantityChange,e.total_cost_cents totalCostCents,
    i.purchase_uom purchaseUom,i.stock_uom stockUom,i.units_per_purchase unitsPerPurchase
    FROM stock_events e JOIN items i ON i.id=e.item_id AND i.store_id=e.store_id WHERE e.id=? AND e.store_id=?`).get(id,localStore.storeId) as RecordRow | undefined;
}
function assertLatest(row:RecordRow,newDate?:string) {
  const later=sqlite.prepare("SELECT 1 FROM stock_events WHERE store_id=? AND item_id=? AND warehouse_id=? AND id<>? AND (rowid>? OR business_date>?) LIMIT 1")
    .get(localStore.storeId,row.itemId,row.warehouseId,row.id,row.rowId,newDate ?? row.businessDate);
  if(later) throw new Error("该商品在此仓库已有后续库存流水，不能直接删改历史记录；请保留原单并通过当期盘点调整修正。");
}
function audit(action:string,id:string,payload:unknown) {
  sqlite.prepare("INSERT INTO audit_logs (id,store_id,action,entity_type,entity_id,payload_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)")
    .run(randomUUID(),localStore.storeId,action,"stock_event",id,JSON.stringify(payload),new Date().toISOString(),localStore.actor);
}
export async function GET() { const dashboard=await getDashboard(localStore.storeId); return NextResponse.json({records:dashboard.stockRecords}); }
export async function DELETE(request:NextRequest) {
  try {
    const {id}=z.object({id:z.string().min(1)}).parse(await request.json()); await ready();
    sqlite.transaction(()=>{
      const row=record(id); if(!row) throw new Error("库存记录不存在。");
      assertStockPeriodOpen(localStore.storeId,row.businessDate);
      assertStockWarehouse(localStore.storeId,row.warehouseId);
      if(!["manual","adjustment"].includes(row.sourceType)) throw new Error("导入或系统单据不能直接删除；请用当期盘点调整修正。");
      assertLatest(row);
      sqlite.prepare("DELETE FROM stock_events WHERE id=? AND store_id=?").run(id,localStore.storeId);
      stockBalance(localStore.storeId,row.itemId,row.warehouseId);
      audit("delete_stock_record",id,row);
    })();
    return NextResponse.json({message:"库存记录已删除，数量和金额余额已同步更新。"});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"删除库存记录失败"},{status:400});}
}
export async function PATCH(request:NextRequest) {
  try {
    const input=editSchema.parse(await request.json()); await ready();
    const result=sqlite.transaction(()=>{
      const row=record(input.id); if(!row) throw new Error("库存记录不存在。");
      // 即使无变化保存也不可绕过闭账边界；不会写入数据或改成本快照。
      assertStockPeriodOpen(localStore.storeId,row.businessDate); assertStockPeriodOpen(localStore.storeId,input.businessDate);
      assertStockWarehouse(localStore.storeId,row.warehouseId);
      if(row.eventType!=="purchase" || row.sourceType!=="manual") throw new Error("仅允许修改手工采购入库记录；系统单据请通过原业务退货或当期调整处理。");
      const originalMode=row.conversionFactor!==1 || row.inputUom===row.purchaseUom ? "purchase" : "stock";
      const sameOriginalUnit=input.quantityUom===originalMode || (row.conversionFactor===1 && row.unitsPerPurchase===1 && row.purchaseUom===row.stockUom);
      const originalQuantity=row.inputQuantity ?? row.quantityChange;
      const originalCost=row.inputUnitCostCents ?? row.unitCostCents*row.conversionFactor;
      if(input.businessDate===row.businessDate && input.quantity===originalQuantity && Math.abs(input.unitCostCents-originalCost)<1e-9 && sameOriginalUnit) return {unchanged:true};
      assertLatest(row,input.businessDate);
      const factor=sameOriginalUnit ? row.conversionFactor : input.quantityUom==="purchase" ? row.unitsPerPurchase : 1;
      const converted=convertToStockUnit({quantity:input.quantity,quantityUom:"purchase",unitsPerPurchase:factor,unitCostCents:input.unitCostCents});
      const inputUom=sameOriginalUnit ? row.inputUom ?? (input.quantityUom==="purchase"?row.purchaseUom:row.stockUom) : input.quantityUom==="purchase"?row.purchaseUom:row.stockUom;
      const amount=Math.round(input.quantity*input.unitCostCents); if(!Number.isSafeInteger(amount)) throw new Error("库存金额超出有效范围");
      sqlite.prepare("UPDATE stock_events SET business_date=?,input_quantity=?,input_uom=?,conversion_factor=?,input_unit_cost_cents=?,quantity_change=?,unit_cost_cents=?,total_cost_cents=? WHERE id=? AND store_id=?")
        .run(input.businessDate,input.quantity,inputUom,converted.conversionFactor,input.unitCostCents,converted.stockQuantity,converted.stockUnitCostCents,amount,input.id,localStore.storeId);
      stockBalance(localStore.storeId,row.itemId,row.warehouseId);
      audit("update_purchase_record",input.id,{before:row,after:input}); return {unchanged:false};
    })();
    return NextResponse.json({...result,message:result.unchanged?"记录未变化，保留原有成本与单据快照。":"采购入库记录已修改，数量和金额余额已同步更新。"});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"修改库存记录失败"},{status:400});}
}
