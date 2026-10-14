import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as saveRecipe, GET as listRecipes, DELETE as deleteRecipe } from "@/app/api/recipes/route";
import { DELETE as deleteItem, GET as masterData } from "@/app/api/master-data/route";
import { createItem, ready } from "@/lib/services";
import { localStore } from "@/lib/local-store";

const request = (body: unknown) => new NextRequest("http://localhost/api/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function item() { return createItem({ ...localStore, sku: `R-${randomUUID()}`, name: "配方保护测试", category: "测试", purchaseUom: "g", stockUom: "g", unitsPerPurchase: 1, unitNetContent: 1, contentUom: "g", purchasePriceCents: 0, minimumQty: 0 }); }
const recipe = (itemId: string, salesSku = "") => ({ name: `菜-${randomUUID()}`, salesSku, lines: [{ itemId, sourceQuantity: 100, sourceUom: "g" }] });

describe("配方引用和销售编码公开接口", () => {
  beforeAll(async () => { if (!process.env.RESTAURANT_DATA_DIR?.includes(".review-temp")) throw new Error("仅隔离测试"); process.env.RESTAURANT_SEED_MODE="blank"; await ready(); });
  it("已被配方引用的商品删除只停用，配方原料仍完整显示", async () => {
    const raw = await item(); const saved = await (await saveRecipe(request(recipe(raw.id)))).json();
    const response = await deleteItem(request({ id: raw.id })); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ mode: "deactivated" });
    const master = await (await masterData()).json(); expect(master.items.find((row: { id: string }) => row.id === raw.id)).toMatchObject({ active: false });
    const recipes = await (await listRecipes()).json(); expect(recipes.recipes.find((row: { id: string }) => row.id === saved.id).lines).toHaveLength(1);
  });
  it("启用的销售 SKU 忽略首尾空格和大小写防重复，但保留编码符号含义", async () => {
    const raw = await item(); const sku = randomUUID();
    expect((await saveRecipe(request(recipe(raw.id, `MT-${sku}`)))).status).toBe(200);
    const duplicate = await saveRecipe(request(recipe(raw.id, ` mt-${sku} `))); expect(duplicate.status).toBe(400); expect(await duplicate.json()).toMatchObject({ error: expect.stringContaining("销售 SKU") });
    expect((await saveRecipe(request(recipe(raw.id, `MT${sku}`)))).status).toBe(200);
  });
  it("单条包装不能换算仍可保存配方并明确标注原料，其余原料保持可用", async () => {
    const raw = await item();
    const bottle = await createItem({ ...localStore, sku: `B-${randomUUID()}`, name: "测试瓶装原料", category: "测试", purchaseUom: "箱", stockUom: "瓶", unitsPerPurchase: 10, unitNetContent: 500, contentUom: "ml", purchasePriceCents: 0, minimumQty: 0 });
    const saved = await saveRecipe(request({ ...recipe(raw.id), lines: [{ itemId: raw.id, sourceQuantity: 130, sourceUom: "g" }, { itemId: bottle.id, sourceQuantity: 1, sourceUom: "袋" }] }));
    expect(saved.status).toBe(200); const result = await saved.json(); expect(result.pendingLines).toEqual([expect.stringContaining("测试瓶装原料")]);
    const all = await (await listRecipes()).json(); expect(all.recipes.find((row: { id: string }) => row.id === result.id).lines).toEqual([expect.objectContaining({ itemId: raw.id, conversionStatus: "ready", stockQuantity: 130 }), expect.objectContaining({ itemId: bottle.id, conversionStatus: "pending", stockQuantity: 0 })]);
  });
});
