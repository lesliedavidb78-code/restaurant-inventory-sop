import { eq } from "drizzle-orm";
import { db, ensureSchema } from "./index";
import { items, stores, warehouses } from "./schema";

// Historical identifier is retained for compatibility; all public data is fictitious.
export const STORE_ID = "store-restaurant";
export async function seedDatabase() {
  ensureSchema();
  if ((await db.select().from(stores).where(eq(stores.id, STORE_ID))).length) return;
  const meta = { createdAt: new Date().toISOString(), createdBy: "公开版初始化" };
  await db.insert(stores).values({ id: STORE_ID, name: "示例餐厅（虚构）", code: "DEMO", ...meta });
  await db.insert(warehouses).values({ id: "wh-main", storeId: STORE_ID, name: "门店总仓", type: "main", boothId: null, ...meta });
  if (process.env.RESTAURANT_SEED_MODE === "blank") return;
  await db.insert(items).values([
    { id: "demo-potato", storeId: STORE_ID, sku: "DEMO-001", name: "示例土豆", category: "示例蔬菜", purchaseUom: "kg", stockUom: "g", unitsPerPurchase: 1000, unitNetContent: 1, contentUom: "g", purchasePriceCents: 0, minimumQty: 0, ...meta },
    { id: "demo-beef", storeId: STORE_ID, sku: "DEMO-002", name: "示例牛肉", category: "示例肉类", purchaseUom: "袋", stockUom: "g", unitsPerPurchase: 1000, unitNetContent: 1, contentUom: "g", purchasePriceCents: 0, minimumQty: 0, ...meta },
  ]);
  // No revenue, supplier, balance, recipe, purchase or stock event is seeded.
}
