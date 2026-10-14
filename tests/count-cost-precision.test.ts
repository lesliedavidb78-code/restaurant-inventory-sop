import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ready, createItem, getDashboard } from '@/lib/services';
import { localStore } from '@/lib/local-store';
import { sqlite } from '@/lib/db';
import { createStockCount, confirmStockCount } from '@/lib/reconciliation';

it('克级库存盘亏也按精确账面单位价值计算，不把半袋35元牛肉算成20元', async () => {
  if (!process.env.RESTAURANT_DATA_DIR?.includes('.review-temp')) throw new Error('只允许隔离账本');
  await ready();
  const item = await createItem({ ...localStore, sku: 'GRAM-' + randomUUID().slice(0, 8), name: '精度测试牛肉', category: '测试', purchaseUom: '袋', stockUom: 'g', unitsPerPurchase: 1000, unitNetContent: 1, contentUom: 'g', purchasePriceCents: 3500, minimumQty: 0 });
  sqlite.prepare('INSERT INTO stock_events(id,store_id,item_id,warehouse_id,event_type,business_date,quantity_change,unit_cost_cents,total_cost_cents,source_type,source_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(), localStore.storeId, item.id, 'wh-main', 'purchase', '2026-10-13', 1000, 3.5, 3500, 'manual', 'precision-fixture', '2026-10-13');
  const count = createStockCount({ storeId: localStore.storeId, warehouseId: 'wh-main', businessDate: '2026-10-13', mode: 'open', note: '', actor: 'test' });
  confirmStockCount({ storeId: localStore.storeId, countId: count.id, actor: 'test', lines: [{ itemId: item.id, countedQuantity: 500, reason: '盘亏' }] });
  const stock = (await getDashboard(localStore.storeId)).stock.find(row => row.item_id === item.id)!;
  expect(stock.quantity).toBe(500);
  expect(stock.value_cents).toBe(1750);
});
