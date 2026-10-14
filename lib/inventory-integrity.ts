import { sqlite } from './db';
import { parsePackageSpecification } from './domain/package-spec';

export type InventoryIntegrityIssue = { kind: string; count: number; message: string };

/** Read-only legacy audit; installing an update must never guess how to repair old facts. */
export function getInventoryIntegrityIssues(storeId: string): InventoryIntegrityIssue[] {
  const issues: InventoryIntegrityIssue[] = [];
  const check = (kind: string, query: string, message: string) => {
    const result = sqlite.prepare(query).get(storeId) as { count: number };
    if (result.count) issues.push({ kind, count: result.count, message });
  };
  check('balance', `SELECT COUNT(*) count FROM (SELECT item_id,warehouse_id,SUM(quantity_change) q,SUM(total_cost_cents) v
    FROM stock_events WHERE store_id=? GROUP BY item_id,warehouse_id
    HAVING q < -0.000000001 OR v < 0 OR (ABS(q) < 0.000000001 AND v <> 0))`, '历史库存存在负数量、负价值或零数量残值，请先核对后用明确调整修正；升级未自动改写旧账。');
  check('stock_reference', `SELECT COUNT(*) count FROM stock_events e LEFT JOIN items i ON i.id=e.item_id AND i.store_id=e.store_id
    LEFT JOIN warehouses w ON w.id=e.warehouse_id AND w.store_id=e.store_id WHERE e.store_id=? AND (i.id IS NULL OR w.id IS NULL)`, '历史库存流水存在失效商品或仓库引用，请核实原单，不要重复录入补账。');
  check('recipe_reference', `SELECT COUNT(*) count FROM recipe_lines l JOIN recipes r ON r.id=l.recipe_id
    LEFT JOIN items i ON i.id=l.item_id AND i.store_id=r.store_id WHERE r.store_id=? AND i.id IS NULL`, '历史配方有失效原料，必须重新选择真实商品后才能计算理论耗用。');
  check('sales_sku_conflict', `SELECT COUNT(*) count FROM (SELECT lower(trim(sales_sku)) sku FROM recipes
    WHERE store_id=? AND active=1 AND trim(sales_sku)<>'' GROUP BY lower(trim(sales_sku)) HAVING COUNT(*)>1)`, '存在多个启用配方使用同一销售 SKU，系统不再自动任选，请修改编码或人工确认映射。');
  const legacyPackages = sqlite.prepare(`SELECT specification,purchase_uom purchaseUom,stock_uom stockUom FROM items i
    WHERE i.store_id=? AND i.active=1 AND trim(i.specification)<>'' AND i.units_per_purchase=1 AND i.unit_net_content=1
    AND i.purchase_uom=i.stock_uom AND i.content_uom=i.stock_uom AND EXISTS(SELECT 1 FROM stock_events e WHERE e.item_id=i.id)`)
    .all(storeId) as { specification: string; purchaseUom: string; stockUom: string }[];
  const packages = legacyPackages.filter(item => {
    const parsed = parsePackageSpecification(item.specification, item.purchaseUom, item.stockUom);
    return parsed && (parsed.unitsPerPurchase !== 1 || parsed.stockUom !== item.stockUom || parsed.contentUom !== item.stockUom);
  }).length;
  if (packages) issues.push({ kind: 'legacy_package', count: packages, message: '旧商品规格与默认包装字段有差异且已有流水，请核实历史数量口径后修改，升级不会自动乘改旧库存。' });
  return issues;
}
