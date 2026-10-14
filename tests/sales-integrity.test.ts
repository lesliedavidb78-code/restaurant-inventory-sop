import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { sqlite } from "@/lib/db";
import { createItem, ready } from "@/lib/services";
import { localStore } from "@/lib/local-store";
import { commitSalesImport, confirmSalesRecipe, getReconciliation } from "@/lib/reconciliation";
import { POST as saveRecipe, DELETE as deleteRecipe, GET as listRecipes } from "@/app/api/recipes/route";
import { NextRequest } from "next/server";

const date = "2026-10-13";
const request = (body: unknown) => new NextRequest("http://localhost/api/recipes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const preview = (dishName: string, salesSku = "") => ({ fileName: "sales.xlsx", fileHash: randomUUID(), businessDate: date, sheetName: "销量", lines: [{ row: 2, salesSku, dishName, quantity: 1 }], warnings: [], errors: [] });
async function rawItem() { return createItem({ ...localStore, sku: `R-${randomUUID()}`, name: "理论耗用原料", category: "测试", purchaseUom: "g", stockUom: "g", unitsPerPurchase: 1, unitNetContent: 1, contentUom: "g", purchasePriceCents: 0, minimumQty: 0 }); }
function legacyRecipe(itemId: string, sku: string, amount: number) {
  const id = randomUUID();
  sqlite.prepare("INSERT INTO recipes (id,store_id,name,sales_sku,updated_at,created_at,created_by) VALUES (?,?,?,?,?,?,?)").run(id, localStore.storeId, `旧配方-${id}`, sku, date, date, "legacy-fixture");
  sqlite.prepare("INSERT INTO recipe_lines (id,recipe_id,item_id,source_quantity,source_uom,stock_quantity,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)").run(randomUUID(), id, itemId, amount, "g", amount, date, "legacy-fixture");
  return id;
}

describe("销量配方上下文和旧数据歧义", () => {
  beforeAll(async () => { if (!process.env.RESTAURANT_DATA_DIR?.includes(".review-temp")) throw new Error("仅隔离测试"); process.env.RESTAURANT_SEED_MODE="blank"; await ready(); });
  it("旧账本重复精确销售 SKU 待人工确认，不自动任选一条配方", async () => {
    const item = await rawItem(); const sku = randomUUID(); legacyRecipe(item.id, sku, 100); legacyRecipe(item.id, sku, 900);
    const result = commitSalesImport({ storeId: localStore.storeId, warehouseId: "wh-main", actor: "test", preview: preview("未指定菜名", sku) });
    expect(result).toMatchObject({ confirmed: 0, pending: 1 });
    expect(getReconciliation(localStore.storeId).variance.some((row) => row.itemId === item.id)).toBe(false);
  });
  it("指定分仓导入后人工匹配仍使用原仓，历史引用配方只能停用", async () => {
    const item = await rawItem(); const name = `嫩牛肉-${randomUUID()}`; const warehouseId = randomUUID();
    sqlite.prepare("INSERT INTO warehouses (id,store_id,name,type,created_at,created_by) VALUES (?,?,?,?,?,?)").run(warehouseId, localStore.storeId, "测试分仓", "main", date, "fixture");
    const savedResponse = await saveRecipe(request({ name, lines: [{ itemId: item.id, sourceQuantity: 130, sourceUom: "g" }] })); expect(savedResponse.status).toBe(200); const saved = await savedResponse.json();
    commitSalesImport({ storeId: localStore.storeId, warehouseId, actor: "test", preview: preview(`鸡蛋${name}`) });
    const pending = getReconciliation(localStore.storeId).pendingSales.find((line) => line.dishName === `鸡蛋${name}`)!;
    expect(pending.warehouseId).toBe(warehouseId);
    confirmSalesRecipe({ storeId: localStore.storeId, lineId: String(pending.id), recipeId: saved.id, actor: "test" });
    expect(getReconciliation(localStore.storeId).variance.find((row) => row.itemId === item.id)).toMatchObject({ warehouseId, theoretical: 130 });
    const deleted = await deleteRecipe(request({ id: saved.id })); expect(deleted.status).toBe(200); expect(await deleted.json()).toMatchObject({ mode: "deactivated" });
    const recipes = await (await listRecipes()).json(); expect(recipes.recipes.find((row: { id: string }) => row.id === saved.id)).toMatchObject({ active: 0, lines: [expect.objectContaining({ itemId: item.id })] });
  });
  it("旧缺仓批次拒绝默认主仓，显式核实仓库后才可确认且防止改原仓", async () => {
    const item = await rawItem(); const sku = randomUUID(); const recipeId = legacyRecipe(item.id, sku, 100);
    const source = preview("未匹配旧销量"); const result = commitSalesImport({ storeId: localStore.storeId, warehouseId: "wh-main", actor: "test", preview: source });
    sqlite.prepare("UPDATE sales_import_batches SET warehouse_id=NULL WHERE id=?").run(result.batchId);
    const pending = getReconciliation(localStore.storeId).pendingSales.find((line) => line.dishName === "未匹配旧销量" && line.fileName === source.fileName && !line.warehouseId)!;
    expect(() => confirmSalesRecipe({ storeId: localStore.storeId, lineId: String(pending.id), recipeId, actor: "test" })).toThrow("人工核实");
    expect(getReconciliation(localStore.storeId).variance.some((row) => row.itemId === item.id)).toBe(false);
    confirmSalesRecipe({ storeId: localStore.storeId, lineId: String(pending.id), recipeId, warehouseId: "wh-main", actor: "test" });
    expect(getReconciliation(localStore.storeId).variance.find((row) => row.itemId === item.id)).toMatchObject({ warehouseId: "wh-main", theoretical: 100 });
    expect(() => confirmSalesRecipe({ storeId: localStore.storeId, lineId: String(pending.id), recipeId, warehouseId: "outside", actor: "test" })).toThrow("不能改变");
  });
});
