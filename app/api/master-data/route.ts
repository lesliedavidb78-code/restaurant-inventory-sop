import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/lib/db";
import { booths, items, stores, suppliers, warehouses } from "@/lib/db/schema";
import { createItem, ready, updateItem } from "@/lib/services";
import { localStore } from "@/lib/local-store";

const itemSchema = z.object({
  sku: z.string().trim().max(40).default(""), name: z.string().trim().min(1).max(80), specification: z.string().trim().max(100).optional(), category: z.string().trim().min(1).max(40),
  purchaseUom: z.string().trim().min(1).max(10), stockUom: z.string().trim().min(1).max(10), unitsPerPurchase: z.number().positive(),
  unitNetContent: z.number().positive(), contentUom: z.string().trim().min(1).max(10), purchasePriceCents: z.number().int().nonnegative(), minimumQty: z.number().nonnegative(),
  warningDays: z.number().nonnegative().default(15), targetDays: z.number().positive().default(30), replenishmentFactor: z.number().positive().default(1.2),
});

export async function GET() {
  await ready(); const id = localStore.storeId;
  const [store] = await db.select().from(stores).where(eq(stores.id, id));
  return NextResponse.json({ store, booths: await db.select().from(booths).where(eq(booths.storeId, id)), warehouses: await db.select().from(warehouses).where(eq(warehouses.storeId, id)), items: await db.select().from(items).where(eq(items.storeId, id)), suppliers: await db.select().from(suppliers).where(eq(suppliers.storeId, id)) });
}

export async function POST(request: NextRequest) {
  try {
    const body = itemSchema.parse(await request.json());
    return NextResponse.json(await createItem({ ...body, ...localStore }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "商品建档失败" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = z.object({ id: z.string().min(1) }).parse(await request.json());
    await ready();
    const [item] = await db.select().from(items).where(eq(items.id, id));
    if (!item || item.storeId !== localStore.storeId) throw new Error("商品不存在。");
    const result = sqlite.transaction(() => {
      const referenced = ["stock_events", "recipe_lines", "purchase_order_lines", "stock_count_lines", "theoretical_consumptions"].some((table) => Boolean(sqlite.prepare(`SELECT 1 FROM ${table} WHERE item_id=? LIMIT 1`).get(id)));
      const balance = sqlite.prepare("SELECT warehouse_id,SUM(quantity_change) quantity FROM stock_events WHERE store_id=? AND item_id=? GROUP BY warehouse_id HAVING quantity>0.000001").get(localStore.storeId, id);
      if (balance) throw new Error("该商品当前仍有库存。请先在“库存总览”点击“清理库存”，再停用商品；这样不会丢失历史账目。");
      if (referenced) sqlite.prepare("UPDATE items SET active=0 WHERE id=? AND store_id=?").run(id, localStore.storeId);
      else sqlite.prepare("DELETE FROM items WHERE id=? AND store_id=?").run(id, localStore.storeId);
      sqlite.prepare("INSERT INTO audit_logs (id,store_id,action,entity_type,entity_id,payload_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)")
        .run(randomUUID(), localStore.storeId, referenced ? "deactivate_item" : "delete_item", "item", id, JSON.stringify({ sku: item.sku, reason: referenced ? "被配方、单据或历史账本引用，安全停用" : "无引用" }), new Date().toISOString(), localStore.actor);
      return referenced ? { mode: "deactivated", message: "该商品已被配方、采购、盘点或历史账本引用，已安全停用；原料关联与历史账目均保留，不会物理删除。" } : { mode: "deleted", message: "商品已删除。" };
    })();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "商品删除失败" }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { id, ...body } = itemSchema.extend({ id: z.string().min(1) }).parse(await request.json());
    return NextResponse.json(await updateItem({ id, ...body, ...localStore }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "商品修改失败" }, { status: 400 });
  }
}
