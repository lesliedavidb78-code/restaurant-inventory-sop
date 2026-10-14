import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ready } from "@/lib/services";
import { sqlite } from "@/lib/db";
import { localStore } from "@/lib/local-store";
import { calculateRawInputQuantity, convertRecipeQuantityToStockUnit } from "@/lib/domain/recipe";
import { PRODUCT_2_FULL_SOP_RECIPES, PRODUCT_2_SOP_IMPORT_SUMMARY, SOP_ITEM_ALIASES } from "@/lib/sop-import";
import { matchRecipeIngredient } from "@/lib/domain/recipe-item-matching";

type Item = { id: string; name: string; sku: string; category: string; stockUom: string; unitNetContent: number; contentUom: string; specification: string; active: number };

function allItems() {
  return sqlite.prepare("SELECT id,name,sku,category,stock_uom stockUom,unit_net_content unitNetContent,content_uom contentUom,specification,active FROM items WHERE store_id=? ORDER BY active DESC,name").all(localStore.storeId) as Item[];
}
function findItem(name: string, itemList: Item[]) {
  return matchRecipeIngredient(name, itemList, SOP_ITEM_ALIASES).item as Item | null;
}

function preview() {
  const itemList = allItems();
  return PRODUCT_2_FULL_SOP_RECIPES.map((recipe) => ({ name: recipe.name, sourceName: recipe.sourceName, lines: recipe.ingredients.map((line) => {
    const match = matchRecipeIngredient(line.name, itemList, SOP_ITEM_ALIASES);
    return { ...line, matchedItem: match.item?.name ?? null, matchMethod: match.method, candidates: match.candidates.map((candidate) => ({ name: candidate.item.name, sku: candidate.item.sku, score: candidate.score })) };
  }) }));
}

export async function GET() {
  await ready();
  return NextResponse.json({ recipes: preview(), summary: PRODUCT_2_SOP_IMPORT_SUMMARY });
}

export async function POST(request: NextRequest) {
  try {
    await ready();
    const { createMissing = true } = await request.json().catch(() => ({})) as { createMissing?: boolean };
    const itemList = allItems();
    const now = new Date().toISOString();
    const placeholders: string[] = [];
    const pendingLines: string[] = [];
    const ensureItem = (name: string) => {
      const found = findItem(name, itemList);
      if (found) return found;
      if (!createMissing) throw new Error(`“${name}”尚未建立库存商品。`);
      const item: Item = { id: randomUUID(), name, sku: `SOP-${String(itemList.length + 1).padStart(3, "0")}`, category: "SOP原料待完善", stockUom: "g", unitNetContent: 1, contentUom: "g", specification: "SOP 自动建档，待补采购规格", active: 1 };
      sqlite.prepare("INSERT INTO items (id,store_id,booth_id,sku,name,specification,category,purchase_uom,stock_uom,units_per_purchase,unit_net_content,content_uom,purchase_price_cents,minimum_qty,warning_days,target_days,replenishment_factor,active,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(item.id, localStore.storeId, null, item.sku, item.name, item.specification, "SOP原料待完善", "g", "g", 1, 1, "g", 0, 0, 15, 30, 1.2, 1, now, "SOP自动导入");
      itemList.push(item); placeholders.push(name);
      return item;
    };
    let imported = 0;
    sqlite.transaction(() => {
      for (const recipe of PRODUCT_2_FULL_SOP_RECIPES) {
        if (sqlite.prepare("SELECT id FROM recipes WHERE store_id=? AND name=?").get(localStore.storeId, recipe.name)) continue;
        const recipeId = randomUUID();
        const lines = recipe.ingredients.map((line, index) => {
          const item = ensureItem(line.name);
          const rawInputQuantity = calculateRawInputQuantity(line.quantity, line.yieldRate ?? 100);
          try {
            const converted = convertRecipeQuantityToStockUnit({ sourceQuantity: rawInputQuantity, sourceUom: line.uom, stockUom: item.stockUom, unitNetContent: item.unitNetContent, contentUom: item.contentUom, specification: item.specification });
            return { id: randomUUID(), item, sourceQuantity: line.quantity, sourceUom: line.uom, yieldRate: line.yieldRate ?? 100, stockQuantity: converted.stockQuantity, conversionStatus: "ready", conversionNote: "", sortOrder: index };
          } catch (error) {
            const reason = error instanceof Error ? error.message : "单位换算失败";
            const note = `菜品“${recipe.name}”的原料“${item.name}”（${item.sku}）：SOP 为 ${line.quantity}${line.uom}，库存单位为 ${item.stockUom}；${reason}`;
            pendingLines.push(note);
            return { id: randomUUID(), item, sourceQuantity: line.quantity, sourceUom: line.uom, yieldRate: line.yieldRate ?? 100, stockQuantity: 0, conversionStatus: "pending", conversionNote: note, sortOrder: index };
          }
        });
        sqlite.prepare("INSERT INTO recipes (id,store_id,name,sales_sku,portion_qty,portion_uom,source_type,source_name,note,active,updated_at,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(recipeId, localStore.storeId, recipe.name, "", 1, "份", "sop", recipe.sourceName, "由产品2.0 SOP 自动导入；标注“SOP原料待完善”的商品须补全实际采购规格后再用于理论耗用对账。", 1, now, now, "SOP自动导入");
        const insertLine = sqlite.prepare("INSERT INTO recipe_lines (id,recipe_id,item_id,source_quantity,source_uom,yield_rate,stock_quantity,conversion_status,conversion_note,sort_order,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
        for (const line of lines) insertLine.run(line.id, recipeId, line.item.id, line.sourceQuantity, line.sourceUom, line.yieldRate, line.stockQuantity, line.conversionStatus, line.conversionNote, line.sortOrder, now, "SOP自动导入");
        imported += 1;
      }
    })();
    return NextResponse.json({ imported, placeholders, pendingLines, summary: PRODUCT_2_SOP_IMPORT_SUMMARY, message: imported ? `已导入 ${imported} 个产品 2.0 / 甜品成本卡 / 锅底 SOP 配方；可换算原料已就绪，不能换算的原料已逐条标记为待处理。` : "这些产品 2.0、甜品和锅底 SOP 配方已经导入过。" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "SOP 导入失败" }, { status: 400 });
  }
}
