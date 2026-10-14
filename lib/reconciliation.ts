import { createHash, randomUUID } from "node:crypto";
import { calculateTheoreticalConsumption } from "@/lib/domain/theoretical-consumption";
import { sqlite } from "@/lib/db";
import { suggestSalesRecipeMatches } from "@/lib/domain/sales-matching";
import type { SalesImportPreview } from "@/lib/sales-import";

type Recipe = { id: string; name: string; salesSku: string; active: number };
type RecipeLine = { itemId: string; stockQuantity: number; conversionStatus: "ready" | "pending" };

function stockCountSnapshot(storeId: string, warehouseId: string) {
  const events = sqlite.prepare("SELECT id,item_id,quantity_change,total_cost_cents,conversion_factor,input_uom,business_date FROM stock_events WHERE store_id=? AND warehouse_id=? ORDER BY id").all(storeId, warehouseId);
  const items = sqlite.prepare("SELECT id,stock_uom,units_per_purchase,unit_net_content,content_uom,active FROM items WHERE store_id=? ORDER BY id").all(storeId);
  return createHash("sha256").update(JSON.stringify({ events, items })).digest("hex");
}
export type CountDraftLine = { itemId: string; countedQuantity: number | null; reason: string };

/** All rows are validated and written together. A failed row rolls back every change. */
export function saveStockCountLines(input: { storeId: string; countId: string; lines: CountDraftLine[] }) {
  sqlite.transaction(() => {
    const count = sqlite.prepare("SELECT status FROM stock_counts WHERE id=? AND store_id=?").get(input.countId, input.storeId) as { status: string } | undefined;
    if (!count || count.status !== "draft") throw new Error("盘点单不存在或已确认，不能修改。");
    const ids = new Set<string>();
    for (const line of input.lines) {
      if (ids.has(line.itemId)) throw new Error("盘点商品重复，未保存任何修改。");
      ids.add(line.itemId);
      if (line.countedQuantity !== null && (!Number.isFinite(line.countedQuantity) || line.countedQuantity < 0)) throw new Error("实盘数量必须为非负有限数值。");
      if (typeof line.reason !== "string" || line.reason.length > 120) throw new Error("盘点原因不能超过 120 字。");
      const stored = sqlite.prepare("SELECT book_quantity bookQuantity,unit_cost_cents unitCostCents FROM stock_count_lines WHERE count_id=? AND item_id=?").get(input.countId, line.itemId) as { bookQuantity: number; unitCostCents: number } | undefined;
      if (!stored) throw new Error("盘点商品不存在，未保存任何修改。");
      const difference = line.countedQuantity === null ? null : Number((line.countedQuantity - stored.bookQuantity).toFixed(6));
      sqlite.prepare("UPDATE stock_count_lines SET counted_quantity=?,difference_quantity=?,difference_cost_cents=?,reason=? WHERE count_id=? AND item_id=?")
        .run(line.countedQuantity, difference, difference === null ? 0 : Math.round(difference * stored.unitCostCents), line.reason, input.countId, line.itemId);
    }
  })();
}

/** Explicit rebase: keep entered counts, but require user to verify their cutoff. */
export function rebaseStockCount(input: { storeId: string; countId: string }) {
  sqlite.transaction(() => {
    const count = sqlite.prepare("SELECT warehouse_id warehouseId,status FROM stock_counts WHERE id=? AND store_id=?").get(input.countId, input.storeId) as { warehouseId: string; status: string } | undefined;
    if (!count || count.status !== "draft") throw new Error("只能重新核对未确认的盘点草稿。");
    const lines = sqlite.prepare("SELECT item_id itemId,counted_quantity countedQuantity,reason FROM stock_count_lines WHERE count_id=?").all(input.countId) as CountDraftLine[];
    for (const line of lines) {
      const balance = sqlite.prepare("SELECT COALESCE(SUM(quantity_change),0) q,COALESCE(SUM(total_cost_cents),0) v FROM stock_events WHERE store_id=? AND warehouse_id=? AND item_id=?").get(input.storeId, count.warehouseId, line.itemId) as { q: number; v: number };
      sqlite.prepare("UPDATE stock_count_lines SET book_quantity=?,unit_cost_cents=? WHERE count_id=? AND item_id=?").run(balance.q, balance.q > 0 ? balance.v / balance.q : 0, input.countId, line.itemId);
    }
    saveStockCountLines(inputWithLines(input, lines));
    sqlite.prepare("UPDATE stock_counts SET snapshot_hash=? WHERE id=?").run(stockCountSnapshot(input.storeId, count.warehouseId), input.countId);
  })();
}
const inputWithLines = (input: { storeId: string; countId: string }, lines: CountDraftLine[]) => ({ ...input, lines });

function recipes(storeId: string) {
  return sqlite.prepare("SELECT id,name,sales_sku salesSku,active FROM recipes WHERE store_id=? AND active=1 ORDER BY name").all(storeId) as Recipe[];
}

function addConsumption(input: { storeId: string; batchId: string; salesLineId: string; recipeId: string; quantity: number; warehouseId: string; businessDate: string; actor: string }) {
  const lines = sqlite.prepare("SELECT l.item_id itemId,l.stock_quantity stockQuantity,CASE WHEN i.id IS NULL OR i.active=0 THEN 'pending' ELSE l.conversion_status END conversionStatus FROM recipe_lines l LEFT JOIN items i ON i.id=l.item_id AND i.store_id=? WHERE l.recipe_id=? ORDER BY l.sort_order,l.id").all(input.storeId, input.recipeId) as RecipeLine[];
  if (!lines.length || lines.some((line) => line.conversionStatus !== "ready")) throw new Error("配方存在缺失、停用或无法换算的原料，请先修正配方；本次未确认销量或生成耗用。");
  const insert = sqlite.prepare("INSERT INTO theoretical_consumptions (id,store_id,batch_id,sales_line_id,recipe_id,item_id,warehouse_id,business_date,quantity,unit_cost_cents,total_cost_cents,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const costs = sqlite.prepare("SELECT COALESCE(SUM(quantity_change),0) quantity,COALESCE(SUM(total_cost_cents),0) totalCost FROM stock_events WHERE store_id=? AND item_id=? AND warehouse_id=?");
  for (const row of calculateTheoreticalConsumption({ salesQuantity: input.quantity, recipeId: input.recipeId, lines })) {
    const balance = costs.get(input.storeId, row.itemId, input.warehouseId) as { quantity: number; totalCost: number };
    const unitCostCents = balance.quantity > 0 ? balance.totalCost / balance.quantity : 0;
    insert.run(randomUUID(), input.storeId, input.batchId, input.salesLineId, row.recipeId, row.itemId, input.warehouseId, input.businessDate, row.quantity, unitCostCents, Math.round(row.quantity * unitCostCents), new Date().toISOString(), input.actor);
  }
}

export function commitSalesImport(input: { storeId: string; warehouseId: string; preview: SalesImportPreview; actor: string }) {
  if (input.preview.errors.length || !input.preview.lines.length) throw new Error("销售导入预览无效，请重新选择 Excel 文件。");
  const known = sqlite.prepare("SELECT id FROM sales_import_batches WHERE store_id=? AND file_hash=?").get(input.storeId, input.preview.fileHash);
  if (known) throw new Error("该销售 Excel 已导入过，系统已阻止重复写入。");
  const batchId = randomUUID(); const now = new Date().toISOString(); const list = recipes(input.storeId);
  let confirmed = 0; let pending = 0; let unmatched = 0;
  sqlite.transaction(() => {
    if (!sqlite.prepare("SELECT id FROM warehouses WHERE id=? AND store_id=?").get(input.warehouseId, input.storeId)) throw new Error("销量导入仓库不存在或不属于当前门店。");
    sqlite.prepare("INSERT INTO sales_import_batches (id,store_id,warehouse_id,file_name,file_hash,business_date,status,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(batchId, input.storeId, input.warehouseId, input.preview.fileName, input.preview.fileHash, input.preview.businessDate, "confirmed", now, input.actor);
    const insert = sqlite.prepare("INSERT INTO sales_import_lines (id,batch_id,store_id,sales_sku,dish_name,quantity,recipe_id,match_status,match_method,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    for (const source of input.preview.lines) {
      const lineId = randomUUID();
      const matches = suggestSalesRecipeMatches({ sku: source.salesSku, name: source.dishName }, list);
      const best = matches[0];
      const exactCandidates = best?.method === "sku_exact" ? matches.filter((candidate) => candidate.method === "sku_exact") : matches.filter((candidate) => candidate.method === "name_exact");
      const readiness = best ? sqlite.prepare("SELECT COUNT(*) count,SUM(CASE WHEN i.id IS NULL OR i.active=0 OR l.conversion_status<>'ready' THEN 1 ELSE 0 END) invalid FROM recipe_lines l LEFT JOIN items i ON i.id=l.item_id AND i.store_id=? WHERE l.recipe_id=?").get(input.storeId, best.recipeId) as { count: number; invalid: number } : undefined;
      const exact = best && exactCandidates.length === 1 && (best.method === "sku_exact" || best.method === "name_exact") && readiness && readiness.count > 0 && !readiness.invalid;
      const status = exact ? "confirmed" : best ? "pending" : "unmatched";
      insert.run(lineId, batchId, input.storeId, source.salesSku, source.dishName, source.quantity, exact ? best.recipeId : null, status, exact ? best.method : "", now, input.actor);
      if (exact) { addConsumption({ storeId: input.storeId, batchId, salesLineId: lineId, recipeId: best.recipeId, quantity: source.quantity, warehouseId: input.warehouseId, businessDate: input.preview.businessDate, actor: input.actor }); confirmed += 1; }
      else if (best) pending += 1;
      else unmatched += 1;
    }
  })();
  return { batchId, confirmed, pending, unmatched, businessDate: input.preview.businessDate };
}

export function confirmSalesRecipe(input: { storeId: string; lineId: string; recipeId: string; warehouseId?: string; actor: string }) {
  sqlite.transaction(() => {
  const line = sqlite.prepare("SELECT l.id,l.batch_id batchId,l.quantity,b.business_date businessDate,b.warehouse_id warehouseId FROM sales_import_lines l JOIN sales_import_batches b ON b.id=l.batch_id AND b.store_id=l.store_id WHERE l.id=? AND l.store_id=?").get(input.lineId, input.storeId) as { id: string; batchId: string; quantity: number; businessDate: string; warehouseId: string | null } | undefined;
  if (!line) throw new Error("销售明细不存在。");
  if (line.warehouseId && input.warehouseId && input.warehouseId !== line.warehouseId) throw new Error("不能改变销量批次原导入仓库，请核对原批次。");
  const warehouseId = line.warehouseId ?? input.warehouseId;
  if (!warehouseId) throw new Error("此旧销量批次未记录仓库，请先人工核实并选择原导入仓库；系统不会自动归入主仓。");
  if (!sqlite.prepare("SELECT id FROM warehouses WHERE id=? AND store_id=?").get(warehouseId, input.storeId)) throw new Error("销量仓库不存在或不属于当前门店。");
  const recipe = sqlite.prepare("SELECT id FROM recipes WHERE id=? AND store_id=? AND active=1").get(input.recipeId, input.storeId);
  if (!recipe) throw new Error("所选配方不存在或已停用。");
    if (!line.warehouseId) sqlite.prepare("UPDATE sales_import_batches SET warehouse_id=? WHERE id=? AND store_id=?").run(warehouseId, line.batchId, input.storeId);
    sqlite.prepare("DELETE FROM theoretical_consumptions WHERE sales_line_id=?").run(input.lineId);
    sqlite.prepare("UPDATE sales_import_lines SET recipe_id=?,match_status='confirmed',match_method='manual' WHERE id=? AND store_id=?").run(input.recipeId, input.lineId, input.storeId);
    addConsumption({ storeId: input.storeId, batchId: line.batchId, salesLineId: line.id, recipeId: input.recipeId, quantity: line.quantity, warehouseId, businessDate: line.businessDate, actor: input.actor });
  })();
}

export function createStockCount(input: { storeId: string; warehouseId: string; businessDate: string; mode: "open" | "blind"; note: string; actor: string }) {
  const id = randomUUID(); const now = new Date().toISOString();
  return sqlite.transaction(() => {
  if (!sqlite.prepare("SELECT id FROM warehouses WHERE id=? AND store_id=?").get(input.warehouseId, input.storeId)) throw new Error("仓库不存在。");
  const rows = sqlite.prepare(`SELECT i.id itemId,COALESCE(SUM(e.quantity_change),0) bookQuantity,CASE WHEN COALESCE(SUM(e.quantity_change),0)>0 THEN COALESCE(SUM(e.total_cost_cents),0)*1.0/SUM(e.quantity_change) ELSE 0 END unitCostCents
    FROM items i LEFT JOIN stock_events e ON e.item_id=i.id AND e.warehouse_id=? AND e.store_id=i.store_id WHERE i.store_id=? AND i.active=1 GROUP BY i.id ORDER BY i.category,i.name`).all(input.warehouseId, input.storeId) as { itemId: string; bookQuantity: number; unitCostCents: number }[];
  sqlite.transaction(() => {
    sqlite.prepare("INSERT INTO stock_counts (id,store_id,warehouse_id,business_date,mode,status,note,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)").run(id, input.storeId, input.warehouseId, input.businessDate, input.mode, "draft", input.note, now, input.actor);
    const insert = sqlite.prepare("INSERT INTO stock_count_lines (id,count_id,item_id,book_quantity,counted_quantity,difference_quantity,unit_cost_cents,difference_cost_cents,reason,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    rows.forEach((row) => insert.run(randomUUID(), id, row.itemId, row.bookQuantity, null, null, row.unitCostCents, 0, "", now, input.actor));
    sqlite.prepare("UPDATE stock_counts SET snapshot_hash=? WHERE id=?").run(stockCountSnapshot(input.storeId, input.warehouseId), id);
  })();
  return { id, lineCount: rows.length };
  })();
}

export function updateStockCountLine(input: { storeId: string; countId: string; itemId: string; countedQuantity: number | null; reason: string }) {
  saveStockCountLines({ ...input, lines: [input] });
}

export function confirmStockCount(input: { storeId: string; countId: string; actor: string; lines?: CountDraftLine[] }) {
  return sqlite.transaction(() => {
  const count = sqlite.prepare("SELECT id,warehouse_id warehouseId,business_date businessDate,status,snapshot_hash snapshotHash FROM stock_counts WHERE id=? AND store_id=?").get(input.countId, input.storeId) as { id: string; warehouseId: string; businessDate: string; status: string; snapshotHash: string } | undefined;
  if (!count || count.status !== "draft") throw new Error("盘点单不存在或已确认。");
  if (!count.snapshotHash || count.snapshotHash !== stockCountSnapshot(input.storeId, count.warehouseId)) throw new Error("盘点创建后库存流水或商品单位已变化，请先保存草稿，再点击“重新核对账面数”，核实实盘时点后确认；本次未调整库存。");
  if (input.lines) saveStockCountLines({ ...input, lines: input.lines });
  const lines = sqlite.prepare("SELECT l.item_id itemId,l.difference_quantity differenceQuantity,l.unit_cost_cents unitCostCents,l.reason,i.stock_uom stockUom FROM stock_count_lines l JOIN items i ON i.id=l.item_id WHERE l.count_id=? AND l.counted_quantity IS NOT NULL").all(input.countId) as { itemId: string; differenceQuantity: number; unitCostCents: number; reason: string; stockUom: string }[];
  if (!lines.length) throw new Error("请至少填写一项实盘数量后再确认。");
  const now = new Date().toISOString(); let adjusted = 0;
  sqlite.transaction(() => {
    const insert = sqlite.prepare("INSERT INTO stock_events (id,store_id,item_id,warehouse_id,event_type,business_date,quantity_change,input_quantity,input_uom,conversion_factor,input_unit_cost_cents,unit_cost_cents,total_cost_cents,source_type,source_id,note,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const line of lines) {
      if (Math.abs(line.differenceQuantity) < 0.000001) continue;
      const eventId = randomUUID();
      insert.run(eventId, input.storeId, line.itemId, count.warehouseId, "adjustment", count.businessDate, line.differenceQuantity, Math.abs(line.differenceQuantity), line.stockUom, 1, null, line.unitCostCents, Math.round(line.differenceQuantity * line.unitCostCents), "stock_count", input.countId, `盘点${line.differenceQuantity > 0 ? "盘盈" : "盘亏"}${line.reason ? `：${line.reason}` : ""}`, now, input.actor);
      adjusted += 1;
    }
    sqlite.prepare("UPDATE stock_counts SET status='confirmed',confirmed_at=? WHERE id=? AND store_id=?").run(now, input.countId, input.storeId);
  })();
  return { adjusted };
  })();
}

export function deleteStockCount(input: { storeId: string; countId: string }) {
  const count = sqlite.prepare("SELECT status FROM stock_counts WHERE id=? AND store_id=?").get(input.countId, input.storeId) as { status: string } | undefined;
  if (!count) throw new Error("盘点单不存在。");
  if (count.status !== "draft") throw new Error("已确认盘点单不能删除；请用盘点调整修正。");
  sqlite.transaction(() => { sqlite.prepare("DELETE FROM stock_count_lines WHERE count_id=?").run(input.countId); sqlite.prepare("DELETE FROM stock_counts WHERE id=? AND store_id=?").run(input.countId, input.storeId); })();
}

export function getReconciliation(storeId: string) {
  const list = recipes(storeId);
  const pendingSales = sqlite.prepare("SELECT l.id,l.sales_sku salesSku,l.dish_name dishName,l.quantity,l.match_status matchStatus,b.file_name fileName,b.business_date businessDate,b.warehouse_id warehouseId FROM sales_import_lines l JOIN sales_import_batches b ON b.id=l.batch_id WHERE l.store_id=? AND l.match_status<>'confirmed' ORDER BY b.created_at DESC,l.dish_name").all(storeId) as { id: string; salesSku: string; dishName: string; quantity: number; matchStatus: string; fileName: string; businessDate: string; warehouseId: string | null }[];
  const pendingWithCandidates = pendingSales.map((line) => ({ ...line, candidates: suggestSalesRecipeMatches({ sku: String(line.salesSku ?? ""), name: String(line.dishName) }, list) }));
  const recipeIssues = sqlite.prepare("SELECT r.name recipeName,COALESCE(i.name,'原料档案缺失') itemName,COALESCE(i.sku,'') sku,CASE WHEN i.id IS NULL THEN '原料档案缺失，请重新关联。' WHEN i.active=0 THEN '原料已停用，请核实并重新关联。' ELSE l.conversion_note END conversionNote FROM recipe_lines l JOIN recipes r ON r.id=l.recipe_id LEFT JOIN items i ON i.id=l.item_id AND i.store_id=r.store_id WHERE r.store_id=? AND (l.conversion_status='pending' OR i.id IS NULL OR i.active=0) ORDER BY r.name").all(storeId);
  const incompleteItems = sqlite.prepare("SELECT id,name,sku FROM items WHERE store_id=? AND active=1 AND (TRIM(stock_uom)='' OR TRIM(content_uom)='' OR unit_net_content<=0 OR units_per_purchase<=0) ORDER BY name").all(storeId);
  const counts = sqlite.prepare("SELECT c.id,c.business_date businessDate,c.mode,c.status,c.note,w.name warehouseName,COUNT(l.id) lineCount,SUM(CASE WHEN l.counted_quantity IS NOT NULL THEN 1 ELSE 0 END) enteredCount FROM stock_counts c JOIN warehouses w ON w.id=c.warehouse_id LEFT JOIN stock_count_lines l ON l.count_id=c.id WHERE c.store_id=? GROUP BY c.id ORDER BY c.created_at DESC").all(storeId) as Record<string, unknown>[];
  const variance = sqlite.prepare(`WITH theory AS (SELECT item_id itemId,warehouse_id warehouseId,SUM(quantity) quantity,SUM(total_cost_cents) cost FROM theoretical_consumptions WHERE store_id=? GROUP BY item_id,warehouse_id),
    actual AS (SELECT item_id itemId,warehouse_id warehouseId,SUM(CASE WHEN event_type IN ('sale','issue') THEN -quantity_change ELSE 0 END) manualOutbound,SUM(CASE WHEN event_type='waste' THEN -quantity_change ELSE 0 END) waste,SUM(CASE WHEN event_type='adjustment' THEN quantity_change ELSE 0 END) countAdjustment FROM stock_events WHERE store_id=? GROUP BY item_id,warehouse_id),
    allitems AS (SELECT itemId,warehouseId FROM theory UNION SELECT itemId,warehouseId FROM actual)
    SELECT i.id itemId,i.name itemName,i.sku,i.category,i.stock_uom stockUom,x.warehouseId,w.name warehouseName,COALESCE(t.quantity,0) theoretical,COALESCE(t.cost,0) theoreticalCostCents,COALESCE(a.manualOutbound,0) manualOutbound,COALESCE(a.waste,0) waste,COALESCE(a.countAdjustment,0) countAdjustment FROM allitems x JOIN items i ON i.id=x.itemId JOIN warehouses w ON w.id=x.warehouseId LEFT JOIN theory t ON t.itemId=x.itemId AND t.warehouseId=x.warehouseId LEFT JOIN actual a ON a.itemId=x.itemId AND a.warehouseId=x.warehouseId ORDER BY ABS(COALESCE(a.manualOutbound,0)+COALESCE(a.waste,0)-COALESCE(t.quantity,0)) DESC,i.name,w.name`).all(storeId, storeId) as Record<string, number | string>[];
  return { pendingSales: pendingWithCandidates, recipeIssues, incompleteItems, counts, variance: variance.map((row) => ({ ...row, itemId: String(row.itemId), warehouseId: String(row.warehouseId), warehouseName: String(row.warehouseName), actualConsumption: Number(row.manualOutbound) + Number(row.waste), variance: Number(row.manualOutbound) + Number(row.waste) - Number(row.theoretical) })) };
}

export function getStockCount(storeId: string, countId: string) {
  const head = sqlite.prepare("SELECT c.id,c.business_date businessDate,c.mode,c.status,c.note,w.name warehouseName FROM stock_counts c JOIN warehouses w ON w.id=c.warehouse_id WHERE c.id=? AND c.store_id=?").get(countId, storeId);
  if (!head) throw new Error("盘点单不存在。");
  const lines = sqlite.prepare("SELECT l.item_id itemId,i.name itemName,i.sku,i.category,i.stock_uom stockUom,l.book_quantity bookQuantity,l.counted_quantity countedQuantity,l.difference_quantity differenceQuantity,l.unit_cost_cents unitCostCents,l.difference_cost_cents differenceCostCents,l.reason FROM stock_count_lines l JOIN items i ON i.id=l.item_id WHERE l.count_id=? ORDER BY i.category,i.name").all(countId);
  return { count: head, lines };
}
