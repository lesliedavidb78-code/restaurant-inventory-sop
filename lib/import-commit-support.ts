import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { sqlite } from "@/lib/db";

const finitePositive = z.number().finite().positive();
export const importDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "业务日期无效。");
export const importProductSchema = z.object({
  row: z.number().int().positive(), sku: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(80),
  specification: z.string().trim().max(100).default(""), category: z.string().trim().min(1).max(40),
  purchaseUom: z.string().trim().min(1).max(10), stockUom: z.string().trim().min(1).max(10),
  unitsPerPurchase: finitePositive, unitNetContent: finitePositive, contentUom: z.string().trim().min(1).max(10),
  minimumQty: z.number().finite().nonnegative(),
});
export const wordPreviewSchema = z.object({
  fileName: z.string().min(1).max(240), fileHash: z.string().min(1).max(160).optional(),
  products: z.array(importProductSchema.extend({ purchasePrice: z.number().finite().nonnegative() })).max(10000),
  stockEvents: z.array(z.object({
    row: z.number().int().positive(), sku: z.string().trim().max(40), itemName: z.string().trim().max(80),
    eventType: z.enum(["purchase", "sale", "return", "issue", "issue_return", "waste", "adjustment", "transfer_in", "transfer_out"]),
    businessDate: importDateSchema, quantity: finitePositive, quantityUom: z.enum(["stock", "purchase"]),
    unitCost: z.number().finite().nonnegative().nullish().transform((value) => value ?? undefined), note: z.string().max(500).optional(),
  }).refine((row) => row.sku || row.itemName, "商品 SKU 或名称必填。")).max(10000),
  errors: z.array(z.string()).max(10000), tables: z.number().int().nonnegative(),
});

export const excelCommitSchema = z.object({
  includeClosingStock: z.boolean().default(false),
  preview: z.object({
    fileName: z.string().min(1).max(240), fileHash: z.string().min(1).max(160), closingDate: importDateSchema,
    products: z.array(importProductSchema.extend({ purchasePriceCents: z.number().int().nonnegative() })).max(10000),
    closingStock: z.array(z.object({ sku: z.string().trim().min(1).max(40), quantity: z.number().finite().nonnegative(), quantityUom: z.enum(["stock", "purchase"]).default("stock") })).max(10000),
    purchases: z.array(z.object({ sku: z.string().trim().min(1).max(40), quantity: finitePositive, quantityUom: z.enum(["stock", "purchase"]).default("stock"), unitCostCents: z.number().finite().nonnegative() })).default([]),
    sheets: z.array(z.object({ name: z.string(), productCount: z.number().int().nonnegative(), closingCount: z.number().int().nonnegative(), purchaseCount: z.number().int().nonnegative(), mode: z.enum(["ledger", "purchase_only"]) })).max(1000),
    warnings: z.array(z.string()).default([]), errors: z.array(z.string()),
  }),
});

export function stableContentHash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

/** File identity and the exact submitted content share the same transaction as all business writes. */
export function commitImportBatch<T extends Record<string, unknown>>(input: { storeId: string; actor: string; kind: "word" | "inventory_excel"; fileName: string; fileHash: string; contentHash: string; sheetCount: number }, run: () => T): T & { duplicate?: boolean } {
  return sqlite.transaction(() => {
    const old = sqlite.prepare("SELECT summary_json summary FROM import_batches WHERE store_id=? AND file_hash=?").get(input.storeId, input.fileHash) as { summary: string } | undefined;
    if (old) {
      const summary = JSON.parse(old.summary) as { kind?: string; contentHash?: string; result?: T };
      if (summary.kind !== input.kind || summary.contentHash !== input.contentHash || !summary.result) throw new Error("该文件已导入，或相同文件标识的内容已改变；本次未重复写入，请核对原批次。");
      return { ...summary.result, duplicate: true };
    }
    const result = run(); const batchId = randomUUID(); const now = new Date().toISOString();
    sqlite.prepare("INSERT INTO import_batches (id,store_id,file_name,file_hash,status,sheet_count,error_count,summary_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(batchId, input.storeId, input.fileName, input.fileHash, "committed", input.sheetCount, 0, JSON.stringify({ kind: input.kind, contentHash: input.contentHash, result }), now, input.actor);
    sqlite.prepare("INSERT INTO audit_logs (id,store_id,action,entity_type,entity_id,payload_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)")
      .run(randomUUID(), input.storeId, "commit_inventory_import", "import_batch", batchId, JSON.stringify({ kind: input.kind, result }), now, input.actor);
    return result;
  })();
}

export function importItemIndex(storeId: string) {
  const rows = sqlite.prepare("SELECT id,sku,name FROM items WHERE store_id=?").all(storeId) as { id: string; sku: string; name: string }[];
  const bySku = new Map(rows.map((row) => [row.sku.trim().toUpperCase(), row.id]));
  const byName = new Map<string, string[]>();
  for (const row of rows) byName.set(row.name, [...(byName.get(row.name) ?? []), row.id]);
  return { bySku, byName };
}

export function resolveImportItem(index: ReturnType<typeof importItemIndex>, row: { sku: string; itemName: string; row: number }) {
  if (row.sku) {
    const id = index.bySku.get(row.sku.trim().toUpperCase());
    if (!id) throw new Error(`第 ${row.row} 行 SKU 不存在：${row.sku}；不会按名称回退匹配。`);
    return id;
  }
  const matches = index.byName.get(row.itemName) ?? [];
  if (matches.length !== 1) throw new Error(`第 ${row.row} 行商品${matches.length ? "名称重名，请填写 SKU" : "不存在"}：${row.itemName}`);
  return matches[0];
}
