import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { POST as wordCommit } from "@/app/api/word-import/commit/route";
import { POST as excelCommit } from "@/app/api/inventory-excel/commit/route";
import { GET as masterData } from "@/app/api/master-data/route";
import { closePeriod, createItem, getDashboard, ready } from "@/lib/services";
import { localStore } from "@/lib/local-store";
import { parseInventoryWorkbook } from "@/lib/inventory-excel-import";

const request = (body: unknown) => new NextRequest("http://localhost/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const product = (tag: string) => ({ row: 2, sku: `FIX-${tag}`.toUpperCase(), name: `修复测试${tag}`, specification: "", category: "修复测试", purchaseUom: "g", stockUom: "g", unitsPerPurchase: 1, unitNetContent: 1, contentUom: "g", purchasePrice: 0, minimumQty: 0 });
const row = (sku: string) => ({ row: 2, sku, itemName: "", eventType: "purchase", businessDate: "2026-10-13", quantity: 10, quantityUom: "stock", unitCost: 1 });
async function balance(id: string) { return (await getDashboard(localStore.storeId)).stock.find((item) => item.item_id === id)?.quantity ?? 0; }

describe("公开导入接口原子性", () => {
  beforeAll(async () => {
    if (!process.env.RESTAURANT_DATA_DIR?.includes(".review-temp")) throw new Error("只允许隔离账本测试。");
    process.env.RESTAURANT_SEED_MODE = "blank";
    await ready();
  });
  it("Word 末行失败时商品和前面流水全部回滚，纠正后可重试且只入账一次", async () => {
    const tag = randomUUID().slice(0, 8); const newProduct = product(tag);
    const preview = { fileName: `${tag}.docx`, products: [newProduct], stockEvents: [row(newProduct.sku), { ...row("NO-SUCH-SKU"), row: 3, itemName: newProduct.name }], errors: [], tables: 1 };
    expect((await wordCommit(request(preview))).status).toBe(400);
    const afterFailure = await (await masterData()).json();
    expect(afterFailure.items.some((item: { sku: string }) => item.sku === newProduct.sku)).toBe(false);
    const corrected = { ...preview, stockEvents: [row(newProduct.sku)] };
    expect((await wordCommit(request(corrected))).status).toBe(200);
    const saved = (await (await masterData()).json()).items.find((item: { sku: string }) => item.sku === newProduct.sku);
    expect(await balance(saved.id)).toBe(10);
    expect((await wordCommit(request(corrected))).status).toBe(200);
    expect(await balance(saved.id)).toBe(10);
  });
  it("Excel 采购导入已有 SKU 仍入账，期末结余不会覆盖已有流水", async () => {
    const tag = randomUUID().slice(0, 8); const existing = product(tag);
    const created = await createItem({ ...existing, purchasePriceCents: 0, ...localStore });
    const preview = { fileName: `${tag}.xlsx`, fileHash: tag, closingDate: "2026-10-13", products: [{ ...existing, purchasePriceCents: 0 }], purchases: [{ sku: existing.sku, quantity: 10, quantityUom: "stock", unitCostCents: 100 }], closingStock: [], sheets: [], errors: [], warnings: [] };
    const first = await excelCommit(request({ preview })); expect(first.status).toBe(200); expect(await first.json()).toMatchObject({ skipped: 1, purchaseCount: 1 });
    expect(await balance(created.id)).toBe(10);
    expect((await excelCommit(request({ preview }))).status).toBe(200); expect(await balance(created.id)).toBe(10);
    expect((await excelCommit(request({ preview: { ...preview, purchases: [{ ...preview.purchases[0], quantity: 20 }] } }))).status).toBe(400); expect(await balance(created.id)).toBe(10);
    const closing = { ...preview, fileHash: `${tag}-closing`, purchases: [], closingStock: [{ sku: existing.sku, quantity: 20, quantityUom: "stock" }] };
    const response = await excelCommit(request({ preview: closing, includeClosingStock: true })); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ closingCount: 0, warnings: [expect.stringContaining("盘点")] }); expect(await balance(created.id)).toBe(10);
  });
  it("闭账 Excel 末行入库失败不留下商品；修改到开放月份可正常重新导入", async () => {
    await closePeriod("2026-09", "test", "owner"); const tag = randomUUID().slice(0, 8); const created = product(tag);
    const preview = { fileName: `${tag}.xlsx`, fileHash: tag, closingDate: "2026-09-30", products: [{ ...created, purchasePriceCents: 0 }], purchases: [{ sku: created.sku, quantity: 10, quantityUom: "stock", unitCostCents: 100 }], closingStock: [], sheets: [], errors: [], warnings: [] };
    expect((await excelCommit(request({ preview }))).status).toBe(400);
    expect((await (await masterData()).json()).items.some((item: { sku: string }) => item.sku === created.sku)).toBe(false);
    expect((await excelCommit(request({ preview: { ...preview, closingDate: "2026-10-13" } }))).status).toBe(200);
    const item = (await (await masterData()).json()).items.find((item: { sku: string }) => item.sku === created.sku); expect(await balance(item.id)).toBe(10);
  });
  it("Word 重名原料无 SKU 时拒绝全批，数值不能绕过服务端验证", async () => {
    const tag = randomUUID().slice(0, 8); const first = product(tag); const second = { ...first, sku: `${first.sku}-2` };
    const one = await createItem({ ...first, purchasePriceCents: 0, ...localStore }); await createItem({ ...second, purchasePriceCents: 0, ...localStore });
    const body = { fileName: `${tag}.docx`, products: [], stockEvents: [row(first.sku), { ...row(""), itemName: first.name, row: 3 }], errors: [], tables: 1 };
    const ambiguous = await wordCommit(request(body)); expect(ambiguous.status).toBe(400); expect(await ambiguous.json()).toMatchObject({ error: expect.stringContaining("重名") }); expect(await balance(one.id)).toBe(0);
    const negative = await wordCommit(request({ ...body, stockEvents: [{ ...row(first.sku), quantity: -10 }] })); expect(negative.status).toBe(400); expect(await balance(one.id)).toBe(0);
  });
  it("已有但无流水商品可导入初始结余；闭账初始结余失败不建档", async () => {
    const tag = randomUUID().slice(0, 8); const raw = product(tag); const created = await createItem({ ...raw, purchasePriceCents: 100, ...localStore });
    const preview = { fileName: `${tag}.xlsx`, fileHash: tag, closingDate: "2026-10-13", products: [], purchases: [], closingStock: [{ sku: raw.sku, quantity: 5, quantityUom: "stock" }], sheets: [], errors: [], warnings: [] };
    expect((await excelCommit(request({ preview, includeClosingStock: true }))).status).toBe(200); expect(await balance(created.id)).toBe(5);
    await closePeriod("2026-09", "test", "owner"); const blockedRaw = product(`${tag}-B`);
    const blocked = { ...preview, fileHash: `${tag}-blocked`, closingDate: "2026-09-30", products: [{ ...blockedRaw, purchasePriceCents: 100 }], closingStock: [{ sku: blockedRaw.sku, quantity: 5, quantityUom: "stock" }] };
    expect((await excelCommit(request({ preview: blocked, includeClosingStock: true }))).status).toBe(400);
    expect((await (await masterData()).json()).items.some((item: { sku: string }) => item.sku === blockedRaw.sku)).toBe(false);
  });
  it("Word 每克含小数分的单价只在整笔金额取整，1000g 入库仍为 35 元", async () => {
    const raw = product(randomUUID().slice(0,8));
    const response = await wordCommit(request({ fileName: `${raw.sku}.docx`, products: [raw], stockEvents: [{ ...row(raw.sku), quantity: 1000, unitCost: 0.035 }], errors: [], tables: 1 })); expect(response.status).toBe(200);
    const saved = (await (await masterData()).json()).items.find((item: { sku: string }) => item.sku === raw.sku);
    expect((await getDashboard(localStore.storeId)).stock.find((item) => item.item_id === saved.id)).toMatchObject({ quantity: 1000, value_cents: 3500 });
  });
  it("真实 Excel 金额汇总识别到每克小数分成本，导入 1000g 与 35 元全部守恒", async () => {
    const name = `Precision-${randomUUID().slice(0,8)}`;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["名称", "规格", "单位", "入库", "金额"], [name, "", "g", 1000, 35]]), "测试");
    const parsed = parseInventoryWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), "2026年10月采购.xlsx");
    expect(parsed.errors).toEqual([]); expect(parsed.purchases[0].unitCostCents).toBe(3.5);
    const response = await excelCommit(request({ preview: parsed })); expect(response.status).toBe(200);
    const saved = (await (await masterData()).json()).items.find((item: { sku: string }) => item.sku === parsed.products[0].sku);
    expect((await getDashboard(localStore.storeId)).stock.find((item) => item.item_id === saved.id)).toMatchObject({ quantity: 1000, value_cents: 3500 });
  });
});
