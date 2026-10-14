import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { parsePackageSpecification } from "../domain/package-spec";
import { ensureIntegrityGuards } from './integrity';

const globalForDb = globalThis as unknown as { sqlite?: Database.Database; orm?: ReturnType<typeof drizzle<typeof schema>> };

function openDatabase() {
  const dataDir = process.env.RESTAURANT_DATA_DIR || path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(path.join(dataDir, "restaurant.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return sqlite;
}

export const sqlite = globalForDb.sqlite ?? openDatabase();
export const db = globalForDb.orm ?? drizzle(sqlite, { schema });

if (process.env.NODE_ENV !== "production") {
  globalForDb.sqlite = sqlite;
  globalForDb.orm = db;
}

export function ensureSchema() {
  sqlite.exec("CREATE TABLE IF NOT EXISTS mutation_requests (store_id TEXT NOT NULL,request_id TEXT NOT NULL,operation TEXT NOT NULL,input_hash TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(store_id,request_id,operation))");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS stores (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE TABLE IF NOT EXISTS booths (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, name TEXT NOT NULL, code TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE UNIQUE INDEX IF NOT EXISTS booth_store_code ON booths(store_id, code);
    CREATE TABLE IF NOT EXISTS warehouses (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, booth_id TEXT, name TEXT NOT NULL, type TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, booth_id TEXT, sku TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, purchase_uom TEXT NOT NULL DEFAULT '件', stock_uom TEXT NOT NULL, units_per_purchase REAL NOT NULL DEFAULT 1, unit_net_content REAL NOT NULL DEFAULT 1, content_uom TEXT NOT NULL DEFAULT '件', purchase_price_cents INTEGER NOT NULL DEFAULT 0, minimum_qty REAL NOT NULL DEFAULT 0, warning_days REAL NOT NULL DEFAULT 15, target_days REAL NOT NULL DEFAULT 30, replenishment_factor REAL NOT NULL DEFAULT 1.2, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE UNIQUE INDEX IF NOT EXISTS item_store_sku ON items(store_id, sku);
    CREATE TABLE IF NOT EXISTS category_replenishment_settings (store_id TEXT NOT NULL, name TEXT NOT NULL, warning_days REAL NOT NULL DEFAULT 15, target_days REAL NOT NULL DEFAULT 30, factor REAL NOT NULL DEFAULT 1.2, updated_at TEXT NOT NULL, PRIMARY KEY(store_id,name));
    CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, name TEXT NOT NULL, contact TEXT, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE TABLE IF NOT EXISTS purchase_orders (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, supplier_id TEXT NOT NULL, order_no TEXT NOT NULL, business_date TEXT NOT NULL, expected_date TEXT, status TEXT NOT NULL DEFAULT 'draft', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_store_no ON purchase_orders(store_id,order_no);
    CREATE TABLE IF NOT EXISTS purchase_order_lines (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, item_id TEXT NOT NULL, ordered_quantity REAL NOT NULL, received_quantity REAL NOT NULL DEFAULT 0, returned_quantity REAL NOT NULL DEFAULT 0, quantity_uom TEXT NOT NULL, unit_cost_cents INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_line_item ON purchase_order_lines(order_id,item_id);
    CREATE TABLE IF NOT EXISTS purchase_receipts (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, order_line_id TEXT NOT NULL, warehouse_id TEXT NOT NULL, business_date TEXT NOT NULL, quantity REAL NOT NULL, quantity_uom TEXT NOT NULL, unit_cost_cents INTEGER NOT NULL, stock_event_id TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE TABLE IF NOT EXISTS purchase_returns (id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL, business_date TEXT NOT NULL, quantity REAL NOT NULL, note TEXT NOT NULL DEFAULT '', stock_event_id TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE TABLE IF NOT EXISTS stock_events (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, item_id TEXT NOT NULL, warehouse_id TEXT NOT NULL, event_type TEXT NOT NULL, business_date TEXT NOT NULL, quantity_change REAL NOT NULL, input_quantity REAL, input_uom TEXT, conversion_factor REAL NOT NULL DEFAULT 1, input_unit_cost_cents INTEGER, unit_cost_cents INTEGER NOT NULL, total_cost_cents INTEGER NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE INDEX IF NOT EXISTS stock_item_warehouse ON stock_events(store_id, item_id, warehouse_id, business_date);
    CREATE TABLE IF NOT EXISTS recipes (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, name TEXT NOT NULL, sales_sku TEXT NOT NULL DEFAULT '', portion_qty REAL NOT NULL DEFAULT 1, portion_uom TEXT NOT NULL DEFAULT '份', source_type TEXT NOT NULL DEFAULT 'manual', source_name TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE UNIQUE INDEX IF NOT EXISTS recipe_store_name ON recipes(store_id,name);
    CREATE TABLE IF NOT EXISTS recipe_lines (id TEXT PRIMARY KEY, recipe_id TEXT NOT NULL, item_id TEXT NOT NULL, source_quantity REAL NOT NULL, source_uom TEXT NOT NULL, yield_rate REAL NOT NULL DEFAULT 100, stock_quantity REAL NOT NULL, conversion_status TEXT NOT NULL DEFAULT 'ready', conversion_note TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE UNIQUE INDEX IF NOT EXISTS recipe_line_unique_item ON recipe_lines(recipe_id,item_id);
    CREATE TABLE IF NOT EXISTS sales_import_batches (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, file_name TEXT NOT NULL, file_hash TEXT NOT NULL, business_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed', created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE UNIQUE INDEX IF NOT EXISTS sales_import_store_hash ON sales_import_batches(store_id,file_hash);
    CREATE TABLE IF NOT EXISTS sales_import_lines (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, store_id TEXT NOT NULL, sales_sku TEXT NOT NULL DEFAULT '', dish_name TEXT NOT NULL, quantity REAL NOT NULL, recipe_id TEXT, match_status TEXT NOT NULL, match_method TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE INDEX IF NOT EXISTS sales_import_line_batch ON sales_import_lines(batch_id);
    CREATE TABLE IF NOT EXISTS theoretical_consumptions (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, batch_id TEXT NOT NULL, sales_line_id TEXT NOT NULL, recipe_id TEXT NOT NULL, item_id TEXT NOT NULL, warehouse_id TEXT NOT NULL, business_date TEXT NOT NULL, quantity REAL NOT NULL, unit_cost_cents INTEGER NOT NULL DEFAULT 0, total_cost_cents INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE INDEX IF NOT EXISTS theoretical_consumption_item ON theoretical_consumptions(store_id,item_id,business_date);
    CREATE TABLE IF NOT EXISTS stock_counts (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, warehouse_id TEXT NOT NULL, business_date TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'open', status TEXT NOT NULL DEFAULT 'draft', note TEXT NOT NULL DEFAULT '', confirmed_at TEXT, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE TABLE IF NOT EXISTS stock_count_lines (id TEXT PRIMARY KEY, count_id TEXT NOT NULL, item_id TEXT NOT NULL, book_quantity REAL NOT NULL, counted_quantity REAL, difference_quantity REAL, unit_cost_cents INTEGER NOT NULL DEFAULT 0, difference_cost_cents INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE UNIQUE INDEX IF NOT EXISTS stock_count_line_item ON stock_count_lines(count_id,item_id);
    CREATE TABLE IF NOT EXISTS sales_summaries (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, period TEXT NOT NULL, gross_revenue_cents INTEGER NOT NULL, net_revenue_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL, order_count INTEGER NOT NULL, source_batch_id TEXT, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE UNIQUE INDEX IF NOT EXISTS sales_store_period ON sales_summaries(store_id, period);
    CREATE TABLE IF NOT EXISTS gross_profit_snapshots (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, booth_id TEXT NOT NULL, period TEXT NOT NULL, gross_revenue_cents INTEGER NOT NULL, net_revenue_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL, opening_cents INTEGER NOT NULL, inbound_cents INTEGER NOT NULL, outbound_cents INTEGER NOT NULL, closing_cents INTEGER NOT NULL, cogs_cents INTEGER NOT NULL, gross_profit_cents INTEGER NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE UNIQUE INDEX IF NOT EXISTS gross_store_booth_period ON gross_profit_snapshots(store_id, booth_id, period);
    CREATE TABLE IF NOT EXISTS product_margins (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, period TEXT NOT NULL, category TEXT NOT NULL, product_name TEXT NOT NULL, uom TEXT NOT NULL DEFAULT '份', selling_price_cents INTEGER NOT NULL, purchase_price_cents INTEGER NOT NULL, auxiliary_cost_cents INTEGER NOT NULL DEFAULT 0, portion_qty REAL NOT NULL DEFAULT 1, yield_rate REAL NOT NULL DEFAULT 1, freight_cents INTEGER NOT NULL DEFAULT 0, cost_cents INTEGER NOT NULL, gross_profit_cents INTEGER NOT NULL, gross_margin REAL NOT NULL, calculation_mode TEXT NOT NULL DEFAULT 'standard', source_type TEXT NOT NULL DEFAULT 'manual', source_batch_id TEXT, note TEXT, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE UNIQUE INDEX IF NOT EXISTS product_margin_unique ON product_margins(store_id,period,category,product_name);
    CREATE TABLE IF NOT EXISTS expense_entries (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, period TEXT NOT NULL, category TEXT NOT NULL, amount_cents INTEGER NOT NULL, note TEXT, source_batch_id TEXT, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE TABLE IF NOT EXISTS bank_transactions (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, business_date TEXT NOT NULL, summary TEXT NOT NULL, income_cents INTEGER NOT NULL DEFAULT 0, expense_cents INTEGER NOT NULL DEFAULT 0, balance_cents INTEGER NOT NULL, source_batch_id TEXT, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE TABLE IF NOT EXISTS counterparties (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, kind TEXT NOT NULL, period TEXT NOT NULL DEFAULT '2026-06', name TEXT NOT NULL, original_cents INTEGER NOT NULL, settled_cents INTEGER NOT NULL DEFAULT 0, due_date TEXT, status TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE TABLE IF NOT EXISTS period_closes (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, period TEXT NOT NULL, status TEXT NOT NULL, closed_at TEXT, closed_by TEXT, note TEXT, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE UNIQUE INDEX IF NOT EXISTS close_store_period ON period_closes(store_id, period);
    CREATE TABLE IF NOT EXISTS import_batches (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, file_name TEXT NOT NULL, file_hash TEXT NOT NULL, status TEXT NOT NULL, sheet_count INTEGER NOT NULL, error_count INTEGER NOT NULL DEFAULT 0, summary_json TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE UNIQUE INDEX IF NOT EXISTS import_store_hash ON import_batches(store_id, file_hash);
    CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system');
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS user_store_roles (user_id TEXT NOT NULL, store_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id, store_id));
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS session_expires_at ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
  `);

  const ensureColumn = (table: string, column: string, definition: string) => {
    const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((item) => item.name === column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  ensureColumn("items", "purchase_uom", "TEXT NOT NULL DEFAULT '件'");
  ensureColumn("items", "specification", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("items", "units_per_purchase", "REAL NOT NULL DEFAULT 1");
  ensureColumn("items", "unit_net_content", "REAL NOT NULL DEFAULT 1");
  ensureColumn("items", "content_uom", "TEXT NOT NULL DEFAULT '件'");
  ensureColumn("items", "purchase_price_cents", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("items", "warning_days", "REAL NOT NULL DEFAULT 15");
  ensureColumn("items", "target_days", "REAL NOT NULL DEFAULT 30");
  ensureColumn("items", "replenishment_factor", "REAL NOT NULL DEFAULT 1.2");
  ensureColumn("items", "active", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("stock_events", "input_quantity", "REAL");
  ensureColumn("stock_events", "input_uom", "TEXT");
  ensureColumn("stock_events", "conversion_factor", "REAL NOT NULL DEFAULT 1");
  ensureColumn("stock_events", "input_unit_cost_cents", "INTEGER");
  ensureColumn("stock_counts", "snapshot_hash", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("recipe_lines", "yield_rate", "REAL NOT NULL DEFAULT 100");
  ensureColumn("recipe_lines", "conversion_status", "TEXT NOT NULL DEFAULT 'ready'");
  ensureColumn("recipe_lines", "conversion_note", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("counterparties", "period", "TEXT NOT NULL DEFAULT '2026-06'");
  ensureColumn("sales_import_batches", "warehouse_id", "TEXT");
  // Nullable for legacy rows: never guess/rewrite old commercial amounts on upgrade.
  ensureColumn("purchase_receipts", "original_total_cents", "INTEGER");
  ensureColumn("purchase_returns", "refund_cents", "INTEGER");
  ensureColumn("purchase_returns", "inventory_cost_cents", "INTEGER");
  ensureColumn("purchase_returns", "price_variance_cents", "INTEGER");

  sqlite.prepare(`INSERT OR IGNORE INTO category_replenishment_settings (store_id,name,warning_days,target_days,factor,updated_at)
    SELECT store_id,category,15,30,1.2,? FROM items WHERE TRIM(category)<>'' GROUP BY store_id,category`).run(new Date().toISOString());

  const migrationId = "2026-07-item-pack-spec-v1";
  const migrated = sqlite.prepare("SELECT id FROM schema_migrations WHERE id=?").get(migrationId);
  if (!migrated) {
    sqlite.transaction(() => {
      sqlite.exec(`
        UPDATE items
        SET purchase_uom=stock_uom,
            content_uom=stock_uom,
            purchase_price_cents=COALESCE((SELECT unit_cost_cents FROM stock_events WHERE stock_events.item_id=items.id AND event_type='purchase' ORDER BY business_date LIMIT 1),0)
        WHERE created_by='系统初始化' AND purchase_price_cents=0;
        UPDATE items SET purchase_uom='箱', units_per_purchase=10, unit_net_content=1, content_uom='kg', purchase_price_cents=purchase_price_cents*10 WHERE sku='YL-005' AND created_by='系统初始化';
        UPDATE items SET purchase_uom='箱', units_per_purchase=24, unit_net_content=500, content_uom='ml', purchase_price_cents=purchase_price_cents*24 WHERE sku='YL-006' AND created_by='系统初始化';
        UPDATE items SET purchase_uom='箱', units_per_purchase=20, unit_net_content=1, content_uom='盒', purchase_price_cents=purchase_price_cents*20 WHERE sku='DY-001' AND created_by='系统初始化';
      `);
      sqlite.prepare("INSERT INTO schema_migrations (id,applied_at) VALUES (?,?)").run(migrationId, new Date().toISOString());
    })();
  }

  // Empty new item metadata can be filled safely. Once a ledger exists, never
  // guess whether old numbers meant cases or bags, nor rewrite historical cost.
  const packageRepairMigrationId = "2026-08-package-spec-autofill-v2";
  if (!sqlite.prepare("SELECT id FROM schema_migrations WHERE id=?").get(packageRepairMigrationId)) {
    const candidates = sqlite.prepare("SELECT id,specification,purchase_uom purchaseUom,stock_uom stockUom,units_per_purchase unitsPerPurchase,unit_net_content unitNetContent,content_uom contentUom FROM items WHERE TRIM(specification)<>''").all() as { id: string; specification: string; purchaseUom: string; stockUom: string; unitsPerPurchase: number; unitNetContent: number; contentUom: string }[];
    const repair = sqlite.prepare("UPDATE items SET purchase_uom=?,stock_uom=?,units_per_purchase=?,unit_net_content=?,content_uom=? WHERE id=?");
    sqlite.transaction(() => {
      for (const item of candidates) {
        const parsed = parsePackageSpecification(item.specification, item.purchaseUom || "件", item.stockUom || "件");
        const looksLikeOldDefault = Number(item.unitsPerPurchase) === 1 && Number(item.unitNetContent) === 1 && item.purchaseUom === item.stockUom && item.contentUom === item.stockUom;
        if (parsed && looksLikeOldDefault && (parsed.unitsPerPurchase !== 1 || parsed.stockUom !== item.stockUom || parsed.contentUom !== item.contentUom)) {
          if (sqlite.prepare('SELECT 1 FROM stock_events WHERE item_id=? LIMIT 1').get(item.id)) continue;
          repair.run(parsed.purchaseUom, parsed.stockUom, parsed.unitsPerPurchase, parsed.unitNetContent, parsed.contentUom, item.id);
        }
      }
      sqlite.prepare("INSERT INTO schema_migrations (id,applied_at) VALUES (?,?)").run(packageRepairMigrationId, new Date().toISOString());
    })();
  }
  ensureIntegrityGuards(sqlite);
}
