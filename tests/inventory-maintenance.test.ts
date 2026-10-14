import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSchema, sqlite } from "@/lib/db";
import { appendStockEvent, clearStockAndMaybeDeactivate, createItem, getDashboard, updateItem } from "@/lib/services";

const storeId = "inventory-maintenance-test-store";
const warehouseId = "inventory-maintenance-test-warehouse";
const actor = "自动验收";

function itemInput(sku: string, name: string) {
  return {
    storeId, sku, name, specification: "10件/箱", category: "测试分类",
    purchaseUom: "箱", stockUom: "件", unitsPerPurchase: 10,
    unitNetContent: 1, contentUom: "kg", purchasePriceCents: 0,
    minimumQty: 0, warningDays: 15, targetDays: 30,
    replenishmentFactor: 1.2, actor, role: "owner",
  };
}

beforeEach(() => {
  ensureSchema();
  sqlite.prepare("INSERT OR IGNORE INTO stores (id,name,code,created_at,created_by) VALUES (?,?,?,?,?)").run(storeId, "库存维护测试店", "INVENTORY-MAINTENANCE-TEST", new Date().toISOString(), actor);
  sqlite.prepare("INSERT OR IGNORE INTO warehouses (id,store_id,booth_id,name,type,created_at,created_by) VALUES (?,?,?,?,?,?,?)").run(warehouseId, storeId, null, "测试总仓", "central", new Date().toISOString(), actor);
});

afterEach(() => {
  for (const table of ["audit_logs", "stock_events", "category_replenishment_settings", "items", "warehouses"]) sqlite.prepare(`DELETE FROM ${table} WHERE store_id=?`).run(storeId);
  sqlite.prepare("DELETE FROM stores WHERE id=?").run(storeId);
});

describe("商品完整修改与库存清理连续流程", () => {
  it("一对一单位改名后，旧采购流水也按当前单位展示，且成本数字不被擅自改写", async () => {
    const created = await createItem({ ...itemInput("TEST-UOM-SYNC-001", "单位同步牛肉"), purchaseUom: "件", stockUom: "件", unitsPerPurchase: 1 });
    await appendStockEvent({ storeId, itemId: created.id, warehouseId, eventType: "purchase", businessDate: "2026-08-10", quantity: 10, quantityUom: "stock", unitCostCents: 40000, note: "旧单位采购", actor, role: "owner" });

    await updateItem({
      ...itemInput("TEST-UOM-SYNC-001", "单位同步牛肉"), id: created.id,
      purchaseUom: "斤", stockUom: "斤", unitsPerPurchase: 1,
    });

    const record = (await getDashboard(storeId, "2026-08")).stockRecords.find((row) => row.itemId === created.id);
    expect(record).toMatchObject({ inputUom: "斤", displayUom: "斤", inputUnitCostCents: 40000 });
  });

  it("可把商品单位从件改为斤，继续录入后再清理并隐藏", async () => {
    const created = await createItem(itemInput("TEST-NR-001", "测试鲜牛肉"));
    await updateItem({
      ...itemInput("TEST-NR-001", "测试鲜牛肉"), id: created.id,
      specification: "散装称重", purchaseUom: "斤", stockUom: "斤",
      unitsPerPurchase: 1, unitNetContent: 500, contentUom: "g",
      warningDays: 3, targetDays: 7, replenishmentFactor: 1.2,
    });
    const changed = sqlite.prepare("SELECT name,specification,purchase_uom purchaseUom,stock_uom stockUom,units_per_purchase unitsPerPurchase,unit_net_content unitNetContent,content_uom contentUom,warning_days warningDays,target_days targetDays,replenishment_factor replenishmentFactor FROM items WHERE id=?").get(created.id);
    expect(changed).toMatchObject({ name: "测试鲜牛肉", specification: "散装称重", purchaseUom: "斤", stockUom: "斤", unitsPerPurchase: 1, unitNetContent: 500, contentUom: "g", warningDays: 3, targetDays: 7, replenishmentFactor: 1.2 });

    await appendStockEvent({ storeId, itemId: created.id, warehouseId, eventType: "purchase", businessDate: "2026-08-17", quantity: 5, quantityUom: "stock", unitCostCents: 1800, note: "修改单位后的录入测试", actor, role: "owner" });
    const beforeClear = await getDashboard(storeId, "2026-08");
    expect(beforeClear.stock.find((row) => row.item_id === created.id)).toMatchObject({ quantity: 5, uom: "斤", averageCostCents: 1800 });

    const cleared = await clearStockAndMaybeDeactivate({ storeId, itemId: created.id, warehouseId, businessDate: "2026-08-17", keepVisible: false, actor, role: "owner" });
    expect(cleared).toMatchObject({ quantity: 5, stockUom: "斤", hidden: true });
    const afterClear = await getDashboard(storeId, "2026-08");
    expect(afterClear.items.some((item) => item.id === created.id)).toBe(false);
    expect(afterClear.stock.some((row) => row.item_id === created.id)).toBe(false);
  });

  it("选择清理后继续显示时商品保持启用", async () => {
    const created = await createItem(itemInput("TEST-KEEP-001", "测试保留商品"));
    await appendStockEvent({ storeId, itemId: created.id, warehouseId, eventType: "purchase", businessDate: "2026-08-17", quantity: 2, quantityUom: "stock", unitCostCents: 1000, actor, role: "owner" });
    await clearStockAndMaybeDeactivate({ storeId, itemId: created.id, warehouseId, businessDate: "2026-08-17", keepVisible: true, actor, role: "owner" });
    const item = sqlite.prepare("SELECT active FROM items WHERE id=?").get(created.id) as { active: number };
    expect(item.active).toBe(1);
    expect((await getDashboard(storeId, "2026-08")).items.some((row) => row.id === created.id)).toBe(true);
  });
});
