import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ensureSchema, sqlite } from '@/lib/db';
import { getInventoryIntegrityIssues } from '@/lib/inventory-integrity';

let storeId: string, itemId: string;
describe('旧账本兼容的存储引用保护', () => {
  beforeEach(() => {
    if (!process.env.RESTAURANT_DATA_DIR?.includes('.review-temp')) throw new Error('只允许隔离测试账本');
    ensureSchema(); storeId = randomUUID(); itemId = randomUUID();
    sqlite.prepare('INSERT INTO stores(id,name,code,created_at) VALUES(?,?,?,?)').run(storeId, '保护测试', storeId, '2026-10-13');
    sqlite.prepare('INSERT INTO items(id,store_id,sku,name,category,stock_uom,created_at) VALUES(?,?,?,?,?,?,?)').run(itemId, storeId, 'TEST', '测试原料', '测试', 'g', '2026-10-13');
  });
  it('不能把库存流水写到不存在或其他门店仓库', () => {
    const insert = sqlite.prepare('INSERT INTO stock_events(id,store_id,item_id,warehouse_id,event_type,business_date,quantity_change,unit_cost_cents,total_cost_cents,source_type,source_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    expect(() => insert.run(randomUUID(), storeId, itemId, 'missing', 'purchase', '2026-10-13', 7, 100, 700, 'manual', 'test', '2026-10-13')).toThrow('仓库');
  });
  it('只读提示旧账异常，不自动重写数量和价值', () => {
    const warehouseId = randomUUID();
    sqlite.prepare('INSERT INTO warehouses(id,store_id,name,type,created_at) VALUES(?,?,?,?,?)').run(warehouseId, storeId, '历史仓', 'main', '2026-10-13');
    sqlite.prepare('INSERT INTO stock_events(id,store_id,item_id,warehouse_id,event_type,business_date,quantity_change,unit_cost_cents,total_cost_cents,source_type,source_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(), storeId, itemId, warehouseId, 'adjustment', '2026-10-13', 0, 0, -450, 'legacy-test', 'test', '2026-10-13');
    expect(getInventoryIntegrityIssues(storeId)).toContainEqual(expect.objectContaining({ kind: 'balance', count: 1 }));
    expect(getInventoryIntegrityIssues(storeId)).toContainEqual(expect.objectContaining({ kind: 'balance', count: 1 }));
  });
});
