import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ready } from "@/lib/services";
import { sqlite } from "@/lib/db";
import { localStore } from "@/lib/local-store";
import { calculateRawInputQuantity, convertRecipeQuantityToStockUnit } from "@/lib/domain/recipe";
import { normalizeSalesSku } from "@/lib/domain/sales-matching";

const lineSchema = z.object({
  itemId: z.string().min(1),
  sourceQuantity: z.number().positive(),
  sourceUom: z.string().trim().min(1).max(12),
  yieldRate: z.number().positive().max(100).default(100),
});

const recipeSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(80),
  salesSku: z.string().trim().max(60).default(""),
  portionQty: z.number().positive().default(1),
  portionUom: z.string().trim().min(1).max(12).default("份"),
  sourceType: z.enum(["manual", "sop"]).default("manual"),
  sourceName: z.string().trim().max(160).default(""),
  note: z.string().trim().max(500).default(""),
  active: z.boolean().default(true),
  lines: z.array(lineSchema).min(1).max(80),
});

type ItemForRecipe = { id: string; sku: string; name: string; stock_uom: string; unit_net_content: number; content_uom: string; specification: string; active: number };

function recipeList() {
  const recipes = sqlite.prepare(`SELECT id,name,sales_sku salesSku,portion_qty portionQty,portion_uom portionUom,source_type sourceType,source_name sourceName,note,active,created_at createdAt,updated_at updatedAt FROM recipes WHERE store_id=? ORDER BY active DESC,updated_at DESC,name`).all(localStore.storeId) as Record<string, unknown>[];
  const lines = sqlite.prepare(`SELECT l.id,l.recipe_id recipeId,l.item_id itemId,l.source_quantity sourceQuantity,l.source_uom sourceUom,l.yield_rate yieldRate,l.stock_quantity stockQuantity,CASE WHEN i.id IS NULL OR i.active=0 THEN 'pending' ELSE l.conversion_status END conversionStatus,CASE WHEN i.id IS NULL THEN '原料档案已缺失，请重新选择关联，历史原料行已保留。' WHEN i.active=0 THEN '原料已停用，请核实并重新选择关联。' ELSE l.conversion_note END conversionNote,l.sort_order sortOrder,COALESCE(i.name,'原料档案缺失') itemName,COALESCE(i.sku,'') sku,COALESCE(i.stock_uom,'') stockUom FROM recipe_lines l JOIN recipes r ON r.id=l.recipe_id LEFT JOIN items i ON i.id=l.item_id AND i.store_id=r.store_id WHERE r.store_id=? ORDER BY l.recipe_id,l.sort_order,l.id`).all(localStore.storeId) as Record<string, unknown>[];
  return recipes.map((recipe) => ({ ...recipe, lines: lines.filter((line) => line.recipeId === recipe.id) }));
}

function normalizedLines(lines: z.infer<typeof lineSchema>[]) {
  const seen = new Set<string>();
  return lines.map((line, index) => {
    if (seen.has(line.itemId)) throw new Error("同一商品只能在一个配方中出现一次，请合并用量。");
    seen.add(line.itemId);
    const item = sqlite.prepare("SELECT id,sku,name,stock_uom,unit_net_content,content_uom,specification,active FROM items WHERE store_id=? AND id=?").get(localStore.storeId, line.itemId) as ItemForRecipe | undefined;
    if (!item || !item.active) throw new Error("配方中的原料不存在或已停用，请重新选择。");
    const rawInputQuantity = calculateRawInputQuantity(line.sourceQuantity, line.yieldRate);
    try {
      const converted = convertRecipeQuantityToStockUnit({ sourceQuantity: rawInputQuantity, sourceUom: line.sourceUom, stockUom: item.stock_uom, unitNetContent: item.unit_net_content, contentUom: item.content_uom, specification: item.specification });
      return { ...line, rawInputQuantity, stockQuantity: converted.stockQuantity, conversionStatus: "ready", conversionNote: "", sortOrder: index };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "单位换算失败";
      return {
        ...line,
        rawInputQuantity,
        stockQuantity: 0,
        conversionStatus: "pending",
        conversionNote: `原料“${item.name}”（${item.sku}）：SOP 为 ${line.sourceQuantity}${line.sourceUom}，库存单位为 ${item.stock_uom}；${reason}`,
        sortOrder: index,
      };
    }
  });
}

function saveRecipe(input: z.infer<typeof recipeSchema>) {
  const now = new Date().toISOString();
  const lines = normalizedLines(input.lines);
  const recipeId = input.id ?? randomUUID();
  sqlite.transaction(() => {
    if (input.active && normalizeSalesSku(input.salesSku)) {
      const candidates = sqlite.prepare("SELECT id,name,sales_sku salesSku FROM recipes WHERE store_id=? AND active=1 AND id<>?").all(localStore.storeId, recipeId) as { id: string; name: string; salesSku: string }[];
      const conflict = candidates.find((candidate) => normalizeSalesSku(candidate.salesSku) === normalizeSalesSku(input.salesSku));
      if (conflict) throw new Error(`销售 SKU 已绑定启用配方“${conflict.name}”，请使用不同编码或先停用旧配方；本次未保存。`);
    }
    const existing = sqlite.prepare("SELECT id FROM recipes WHERE id=? AND store_id=?").get(recipeId, localStore.storeId) as { id: string } | undefined;
    if (existing) {
      sqlite.prepare("UPDATE recipes SET name=?,sales_sku=?,portion_qty=?,portion_uom=?,source_type=?,source_name=?,note=?,active=?,updated_at=? WHERE id=? AND store_id=?")
        .run(input.name, input.salesSku, input.portionQty, input.portionUom, input.sourceType, input.sourceName, input.note, input.active ? 1 : 0, now, recipeId, localStore.storeId);
      sqlite.prepare("DELETE FROM recipe_lines WHERE recipe_id=?").run(recipeId);
    } else {
      sqlite.prepare("INSERT INTO recipes (id,store_id,name,sales_sku,portion_qty,portion_uom,source_type,source_name,note,active,updated_at,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(recipeId, localStore.storeId, input.name, input.salesSku, input.portionQty, input.portionUom, input.sourceType, input.sourceName, input.note, input.active ? 1 : 0, now, now, localStore.actor);
    }
    const insertLine = sqlite.prepare("INSERT INTO recipe_lines (id,recipe_id,item_id,source_quantity,source_uom,yield_rate,stock_quantity,conversion_status,conversion_note,sort_order,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const line of lines) insertLine.run(randomUUID(), recipeId, line.itemId, line.sourceQuantity, line.sourceUom, line.yieldRate, line.stockQuantity, line.conversionStatus, line.conversionNote, line.sortOrder, now, localStore.actor);
    sqlite.prepare("INSERT INTO audit_logs (id,store_id,action,entity_type,entity_id,payload_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)")
      .run(randomUUID(), localStore.storeId, existing ? "update_recipe" : "create_recipe", "recipe", recipeId, JSON.stringify({ name: input.name, lineCount: lines.length, sourceType: input.sourceType }), now, localStore.actor);
  })();
  const pending = lines.filter((line) => line.conversionStatus === "pending");
  return { id: recipeId, pendingLines: pending.map((line) => line.conversionNote), message: pending.length ? `配方已保存；${pending.length} 条原料暂不能换算，已标记为“待处理”，不影响其他原料保存。` : "配方已保存。配方档案不会直接扣减库存；销售数据接入后将用于计算理论耗用。" };
}

export async function GET() {
  await ready();
  return NextResponse.json({ recipes: recipeList() });
}

export async function POST(request: NextRequest) {
  try {
    await ready();
    return NextResponse.json(saveRecipe(recipeSchema.parse(await request.json())));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "配方保存失败" }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await ready();
    const input = recipeSchema.extend({ id: z.string().min(1) }).parse(await request.json());
    const found = sqlite.prepare("SELECT id FROM recipes WHERE id=? AND store_id=?").get(input.id, localStore.storeId);
    if (!found) throw new Error("配方不存在，请刷新后重试。");
    return NextResponse.json(saveRecipe(input));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "配方修改失败" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await ready();
    const { id } = z.object({ id: z.string().min(1) }).parse(await request.json());
    const found = sqlite.prepare("SELECT name FROM recipes WHERE id=? AND store_id=?").get(id, localStore.storeId) as { name: string } | undefined;
    if (!found) throw new Error("配方不存在。");
    const now = new Date().toISOString();
    sqlite.transaction(() => {
      const referenced = sqlite.prepare("SELECT 1 FROM sales_import_lines WHERE recipe_id=? UNION ALL SELECT 1 FROM theoretical_consumptions WHERE recipe_id=? LIMIT 1").get(id,id);
      if (referenced) sqlite.prepare("UPDATE recipes SET active=0,updated_at=? WHERE id=? AND store_id=?").run(now,id,localStore.storeId);
      else { sqlite.prepare("DELETE FROM recipe_lines WHERE recipe_id=?").run(id); sqlite.prepare("DELETE FROM recipes WHERE id=? AND store_id=?").run(id, localStore.storeId); }
      sqlite.prepare("INSERT INTO audit_logs (id,store_id,action,entity_type,entity_id,payload_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)")
        .run(randomUUID(), localStore.storeId, referenced ? "deactivate_recipe" : "delete_recipe", "recipe", id, JSON.stringify({ name: found.name }), now, localStore.actor);
    })();
    const retained = sqlite.prepare("SELECT id FROM recipes WHERE id=? AND store_id=?").get(id,localStore.storeId);
    return NextResponse.json({ mode: retained ? "deactivated" : "deleted", message: retained ? "该配方已被销量或理论耗用引用，已安全停用；配方原料与历史耗用均保留。" : "配方已删除；未影响库存或历史流水。" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "配方删除失败" }, { status: 400 });
  }
}
