import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ready } from "@/lib/services";
import { sqlite } from "@/lib/db";
import { localStore } from "@/lib/local-store";
import { calculateRawInputQuantity, convertRecipeQuantityToStockUnit } from "@/lib/domain/recipe";
import { matchRecipeIngredient } from "@/lib/domain/recipe-item-matching";
import { SOP_ITEM_ALIASES } from "@/lib/sop-import";

type Item = { id: string; name: string; sku: string; category: string; stockUom: string; unitNetContent: number; contentUom: string; specification: string; active: number };
type RecipeLine = { id: string; recipeId: string; recipeName: string; itemId: string; itemName: string; itemCategory: string; sourceQuantity: number; sourceUom: string; yieldRate: number };

function listItems() {
  return sqlite.prepare("SELECT id,name,sku,category,stock_uom stockUom,unit_net_content unitNetContent,content_uom contentUom,specification,active FROM items WHERE store_id=? AND active=1 ORDER BY name").all(localStore.storeId) as Item[];
}

function listPlaceholderLines() {
  return sqlite.prepare(`SELECT l.id,l.recipe_id recipeId,r.name recipeName,l.item_id itemId,i.name itemName,i.category itemCategory,l.source_quantity sourceQuantity,l.source_uom sourceUom,l.yield_rate yieldRate
    FROM recipe_lines l JOIN recipes r ON r.id=l.recipe_id JOIN items i ON i.id=l.item_id
    WHERE r.store_id=? AND i.store_id=? AND i.category='SOP原料待完善' ORDER BY r.name,l.sort_order`).all(localStore.storeId, localStore.storeId) as RecipeLine[];
}

export async function POST() {
  try {
    await ready();
    const items = listItems();
    const lines = listPlaceholderLines();
    const matched: string[] = [];
    const pending: Array<{ recipeName: string; ingredient: string; candidates: string[] }> = [];
    const now = new Date().toISOString();
    const updateLine = sqlite.prepare("UPDATE recipe_lines SET item_id=?,stock_quantity=?,conversion_status=?,conversion_note=? WHERE id=?");
    sqlite.transaction(() => {
      for (const line of lines) {
        const match = matchRecipeIngredient(line.itemName, items, SOP_ITEM_ALIASES);
        const item = match.item as Item | null;
        if (!item) {
          pending.push({ recipeName: line.recipeName, ingredient: line.itemName, candidates: match.candidates.map((candidate) => `${candidate.item.name}（${candidate.item.sku}，${candidate.score}分）`) });
          continue;
        }
        const rawInputQuantity = calculateRawInputQuantity(line.sourceQuantity, line.yieldRate || 100);
        try {
          const converted = convertRecipeQuantityToStockUnit({ sourceQuantity: rawInputQuantity, sourceUom: line.sourceUom, stockUom: item.stockUom, unitNetContent: item.unitNetContent, contentUom: item.contentUom, specification: item.specification });
          updateLine.run(item.id, converted.stockQuantity, "ready", "", line.id);
          matched.push(`菜品“${line.recipeName}”：${line.itemName} → ${item.name}（${match.method === "alias" ? "别名" : "高置信度相似"}匹配）`);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "单位换算失败";
          updateLine.run(item.id, 0, "pending", `原料“${item.name}”（${item.sku}）：SOP 为 ${line.sourceQuantity}${line.sourceUom}，库存单位为 ${item.stockUom}；${reason}`, line.id);
          matched.push(`菜品“${line.recipeName}”：${line.itemName} → ${item.name}（已匹配，待补单位换算）`);
        }
      }
      sqlite.prepare("INSERT INTO audit_logs (id,store_id,action,entity_type,entity_id,payload_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)")
        .run(randomUUID(), localStore.storeId, "smart_match_recipe_items", "recipe", "batch", JSON.stringify({ matched: matched.length, pending: pending.length }), now, localStore.actor);
    })();
    return NextResponse.json({ matched, pending, message: matched.length ? `已智能匹配 ${matched.length} 条配方原料；${pending.length} 条因名称不够确定，保留给人工选择。` : `没有可自动确认的配方原料；${pending.length} 条仍需人工确认。` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "智能匹配失败" }, { status: 400 });
  }
}
