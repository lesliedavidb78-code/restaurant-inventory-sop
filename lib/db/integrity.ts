import type Database from 'better-sqlite3';

/** Add guards without rebuilding legacy tables or rewriting historical records. */
export function ensureIntegrityGuards(database: Database.Database) {
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS stock_event_item_insert_guard BEFORE INSERT ON stock_events
    WHEN NOT EXISTS (SELECT 1 FROM items WHERE id=NEW.item_id AND store_id=NEW.store_id)
    BEGIN SELECT RAISE(ABORT,'库存商品引用不存在或不属于当前门店'); END;
    CREATE TRIGGER IF NOT EXISTS stock_event_warehouse_insert_guard BEFORE INSERT ON stock_events
    WHEN NOT EXISTS (SELECT 1 FROM warehouses WHERE id=NEW.warehouse_id AND store_id=NEW.store_id)
    BEGIN SELECT RAISE(ABORT,'库存仓库不存在或不属于当前门店'); END;
    CREATE TRIGGER IF NOT EXISTS stock_event_reference_update_guard BEFORE UPDATE OF item_id,warehouse_id,store_id ON stock_events
    WHEN NOT EXISTS (SELECT 1 FROM items WHERE id=NEW.item_id AND store_id=NEW.store_id)
      OR NOT EXISTS (SELECT 1 FROM warehouses WHERE id=NEW.warehouse_id AND store_id=NEW.store_id)
    BEGIN SELECT RAISE(ABORT,'库存商品或仓库引用无效'); END;
    CREATE TRIGGER IF NOT EXISTS item_referenced_delete_guard BEFORE DELETE ON items
    WHEN EXISTS (SELECT 1 FROM stock_events WHERE item_id=OLD.id)
      OR EXISTS (SELECT 1 FROM recipe_lines WHERE item_id=OLD.id)
      OR EXISTS (SELECT 1 FROM purchase_order_lines WHERE item_id=OLD.id)
      OR EXISTS (SELECT 1 FROM stock_count_lines WHERE item_id=OLD.id)
      OR EXISTS (SELECT 1 FROM theoretical_consumptions WHERE item_id=OLD.id)
    BEGIN SELECT RAISE(ABORT,'商品已被业务单据引用，只能停用，不能删除'); END;
    CREATE TRIGGER IF NOT EXISTS recipe_line_reference_insert_guard BEFORE INSERT ON recipe_lines
    WHEN NOT EXISTS (SELECT 1 FROM recipes r JOIN items i ON i.store_id=r.store_id WHERE r.id=NEW.recipe_id AND i.id=NEW.item_id)
    BEGIN SELECT RAISE(ABORT,'配方原料引用不存在或门店不一致'); END;
    CREATE TRIGGER IF NOT EXISTS recipe_line_reference_update_guard BEFORE UPDATE OF recipe_id,item_id ON recipe_lines
    WHEN NOT EXISTS (SELECT 1 FROM recipes r JOIN items i ON i.store_id=r.store_id WHERE r.id=NEW.recipe_id AND i.id=NEW.item_id)
    BEGIN SELECT RAISE(ABORT,'配方原料引用不存在或门店不一致'); END;
    CREATE TRIGGER IF NOT EXISTS purchase_line_reference_insert_guard BEFORE INSERT ON purchase_order_lines
    WHEN NOT EXISTS (SELECT 1 FROM purchase_orders o JOIN items i ON i.store_id=o.store_id WHERE o.id=NEW.order_id AND i.id=NEW.item_id)
    BEGIN SELECT RAISE(ABORT,'采购商品引用不存在或门店不一致'); END;
    CREATE TRIGGER IF NOT EXISTS count_line_reference_insert_guard BEFORE INSERT ON stock_count_lines
    WHEN NOT EXISTS (SELECT 1 FROM stock_counts c JOIN items i ON i.store_id=c.store_id WHERE c.id=NEW.count_id AND i.id=NEW.item_id)
    BEGIN SELECT RAISE(ABORT,'盘点商品引用不存在或门店不一致'); END;
    CREATE TRIGGER IF NOT EXISTS theoretical_reference_insert_guard BEFORE INSERT ON theoretical_consumptions
    WHEN NOT EXISTS (SELECT 1 FROM items WHERE id=NEW.item_id AND store_id=NEW.store_id)
      OR NOT EXISTS (SELECT 1 FROM warehouses WHERE id=NEW.warehouse_id AND store_id=NEW.store_id)
    BEGIN SELECT RAISE(ABORT,'理论耗用商品或仓库引用无效，请先修正配方'); END;
    CREATE TRIGGER IF NOT EXISTS recipe_referenced_delete_guard BEFORE DELETE ON recipes
    WHEN EXISTS (SELECT 1 FROM sales_import_lines WHERE recipe_id=OLD.id)
      OR EXISTS (SELECT 1 FROM theoretical_consumptions WHERE recipe_id=OLD.id)
    BEGIN SELECT RAISE(ABORT,'配方已有销售或耗用记录，只能停用，不能删除'); END;
  `);
}
