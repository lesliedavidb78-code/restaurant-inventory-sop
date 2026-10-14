import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const audit = {
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull().default("system"),
};

export const stores = sqliteTable("stores", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  ...audit,
});

export const booths = sqliteTable("booths", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...audit,
}, (t) => [uniqueIndex("booth_store_code").on(t.storeId, t.code)]);

export const warehouses = sqliteTable("warehouses", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  boothId: text("booth_id"),
  name: text("name").notNull(),
  type: text("type").notNull(),
  ...audit,
});

export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  boothId: text("booth_id"),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  specification: text("specification").notNull().default(""),
  category: text("category").notNull(),
  purchaseUom: text("purchase_uom").notNull().default("件"),
  stockUom: text("stock_uom").notNull(),
  unitsPerPurchase: real("units_per_purchase").notNull().default(1),
  unitNetContent: real("unit_net_content").notNull().default(1),
  contentUom: text("content_uom").notNull().default("件"),
  purchasePriceCents: integer("purchase_price_cents").notNull().default(0),
  minimumQty: real("minimum_qty").notNull().default(0),
  warningDays: real("warning_days").notNull().default(15),
  targetDays: real("target_days").notNull().default(30),
  replenishmentFactor: real("replenishment_factor").notNull().default(1.2),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...audit,
}, (t) => [uniqueIndex("item_store_sku").on(t.storeId, t.sku)]);

export const suppliers = sqliteTable("suppliers", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  name: text("name").notNull(),
  contact: text("contact"),
  ...audit,
});

export const purchaseOrders = sqliteTable("purchase_orders", {
  id: text("id").primaryKey(), storeId: text("store_id").notNull(), supplierId: text("supplier_id").notNull(),
  orderNo: text("order_no").notNull(), businessDate: text("business_date").notNull(), expectedDate: text("expected_date"),
  status: text("status").notNull().default("draft"), note: text("note").notNull().default(""), ...audit,
}, (t) => [uniqueIndex("purchase_order_store_no").on(t.storeId, t.orderNo)]);

export const purchaseOrderLines = sqliteTable("purchase_order_lines", {
  id: text("id").primaryKey(), orderId: text("order_id").notNull(), itemId: text("item_id").notNull(),
  orderedQuantity: real("ordered_quantity").notNull(), receivedQuantity: real("received_quantity").notNull().default(0),
  returnedQuantity: real("returned_quantity").notNull().default(0), quantityUom: text("quantity_uom").notNull(),
  unitCostCents: integer("unit_cost_cents").notNull().default(0), ...audit,
}, (t) => [uniqueIndex("purchase_order_line_item").on(t.orderId, t.itemId)]);

export const purchaseReceipts = sqliteTable("purchase_receipts", {
  id: text("id").primaryKey(), orderId: text("order_id").notNull(), orderLineId: text("order_line_id").notNull(),
  warehouseId: text("warehouse_id").notNull(), businessDate: text("business_date").notNull(), quantity: real("quantity").notNull(),
  quantityUom: text("quantity_uom").notNull(), unitCostCents: integer("unit_cost_cents").notNull(), stockEventId: text("stock_event_id").notNull(), ...audit,
  originalTotalCents: integer("original_total_cents"),
});

export const purchaseReturns = sqliteTable("purchase_returns", {
  id: text("id").primaryKey(), receiptId: text("receipt_id").notNull(), businessDate: text("business_date").notNull(),
  quantity: real("quantity").notNull(), note: text("note").notNull().default(""), stockEventId: text("stock_event_id").notNull(), ...audit,
  refundCents: integer("refund_cents"),
  inventoryCostCents: integer("inventory_cost_cents"),
  priceVarianceCents: integer("price_variance_cents"),
});

export const stockEvents = sqliteTable("stock_events", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  itemId: text("item_id").notNull(),
  warehouseId: text("warehouse_id").notNull(),
  eventType: text("event_type").notNull(),
  businessDate: text("business_date").notNull(),
  quantityChange: real("quantity_change").notNull(),
  inputQuantity: real("input_quantity"),
  inputUom: text("input_uom"),
  conversionFactor: real("conversion_factor").notNull().default(1),
  inputUnitCostCents: integer("input_unit_cost_cents"),
  // Unit cost may be a fractional cent (e.g. g); only total amounts are integer cents.
  unitCostCents: real("unit_cost_cents").notNull(),
  totalCostCents: integer("total_cost_cents").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  note: text("note"),
  ...audit,
});

export const recipes = sqliteTable("recipes", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  name: text("name").notNull(),
  salesSku: text("sales_sku").notNull().default(""),
  portionQty: real("portion_qty").notNull().default(1),
  portionUom: text("portion_uom").notNull().default("份"),
  sourceType: text("source_type").notNull().default("manual"),
  sourceName: text("source_name").notNull().default(""),
  note: text("note").notNull().default(""),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull(),
  ...audit,
}, (t) => [uniqueIndex("recipe_store_name").on(t.storeId, t.name)]);

export const recipeLines = sqliteTable("recipe_lines", {
  id: text("id").primaryKey(),
  recipeId: text("recipe_id").notNull(),
  itemId: text("item_id").notNull(),
  sourceQuantity: real("source_quantity").notNull(),
  sourceUom: text("source_uom").notNull(),
  yieldRate: real("yield_rate").notNull().default(100),
  stockQuantity: real("stock_quantity").notNull(),
  conversionStatus: text("conversion_status").notNull().default("ready"),
  conversionNote: text("conversion_note").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  ...audit,
}, (t) => [uniqueIndex("recipe_line_unique_item").on(t.recipeId, t.itemId)]);

/** 美团或其他收银系统导入的原始销售菜品行；不直接影响库存。 */
export const salesImportBatches = sqliteTable("sales_import_batches", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  fileName: text("file_name").notNull(),
  fileHash: text("file_hash").notNull(),
  businessDate: text("business_date").notNull(),
  warehouseId: text("warehouse_id"),
  status: text("status").notNull().default("confirmed"),
  ...audit,
}, (t) => [uniqueIndex("sales_import_store_hash").on(t.storeId, t.fileHash)]);

export const salesImportLines = sqliteTable("sales_import_lines", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull(),
  storeId: text("store_id").notNull(),
  salesSku: text("sales_sku").notNull().default(""),
  dishName: text("dish_name").notNull(),
  quantity: real("quantity").notNull(),
  recipeId: text("recipe_id"),
  matchStatus: text("match_status").notNull(),
  matchMethod: text("match_method").notNull().default(""),
  ...audit,
});

/** 从确认销售明细计算出的理论原料耗用；是核对台账，绝不作为实际出库。 */
export const theoreticalConsumptions = sqliteTable("theoretical_consumptions", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  batchId: text("batch_id").notNull(),
  salesLineId: text("sales_line_id").notNull(),
  recipeId: text("recipe_id").notNull(),
  itemId: text("item_id").notNull(),
  warehouseId: text("warehouse_id").notNull(),
  businessDate: text("business_date").notNull(),
  quantity: real("quantity").notNull(),
  unitCostCents: real("unit_cost_cents").notNull().default(0),
  totalCostCents: integer("total_cost_cents").notNull().default(0),
  ...audit,
});

export const stockCounts = sqliteTable("stock_counts", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  warehouseId: text("warehouse_id").notNull(),
  businessDate: text("business_date").notNull(),
  mode: text("mode").notNull().default("open"),
  status: text("status").notNull().default("draft"),
  note: text("note").notNull().default(""),
  confirmedAt: text("confirmed_at"),
  snapshotHash: text("snapshot_hash").notNull().default(""),
  ...audit,
});

export const stockCountLines = sqliteTable("stock_count_lines", {
  id: text("id").primaryKey(),
  countId: text("count_id").notNull(),
  itemId: text("item_id").notNull(),
  bookQuantity: real("book_quantity").notNull(),
  countedQuantity: real("counted_quantity"),
  differenceQuantity: real("difference_quantity"),
  unitCostCents: real("unit_cost_cents").notNull().default(0),
  differenceCostCents: integer("difference_cost_cents").notNull().default(0),
  reason: text("reason").notNull().default(""),
  ...audit,
}, (t) => [uniqueIndex("stock_count_line_item").on(t.countId, t.itemId)]);

export const salesSummaries = sqliteTable("sales_summaries", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  period: text("period").notNull(),
  grossRevenueCents: integer("gross_revenue_cents").notNull(),
  netRevenueCents: integer("net_revenue_cents").notNull(),
  discountCents: integer("discount_cents").notNull(),
  orderCount: integer("order_count").notNull(),
  sourceBatchId: text("source_batch_id"),
  ...audit,
}, (t) => [uniqueIndex("sales_store_period").on(t.storeId, t.period)]);

export const grossProfitSnapshots = sqliteTable("gross_profit_snapshots", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  boothId: text("booth_id").notNull(),
  period: text("period").notNull(),
  grossRevenueCents: integer("gross_revenue_cents").notNull(),
  netRevenueCents: integer("net_revenue_cents").notNull(),
  discountCents: integer("discount_cents").notNull(),
  openingCents: integer("opening_cents").notNull(),
  inboundCents: integer("inbound_cents").notNull(),
  outboundCents: integer("outbound_cents").notNull(),
  closingCents: integer("closing_cents").notNull(),
  cogsCents: integer("cogs_cents").notNull(),
  grossProfitCents: integer("gross_profit_cents").notNull(),
  ...audit,
}, (t) => [uniqueIndex("gross_store_booth_period").on(t.storeId, t.boothId, t.period)]);

export const productMargins = sqliteTable("product_margins", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  period: text("period").notNull(),
  category: text("category").notNull(),
  productName: text("product_name").notNull(),
  uom: text("uom").notNull().default("份"),
  sellingPriceCents: integer("selling_price_cents").notNull(),
  purchasePriceCents: integer("purchase_price_cents").notNull(),
  auxiliaryCostCents: integer("auxiliary_cost_cents").notNull().default(0),
  portionQty: real("portion_qty").notNull().default(1),
  yieldRate: real("yield_rate").notNull().default(1),
  freightCents: integer("freight_cents").notNull().default(0),
  costCents: integer("cost_cents").notNull(),
  grossProfitCents: integer("gross_profit_cents").notNull(),
  grossMargin: real("gross_margin").notNull(),
  calculationMode: text("calculation_mode").notNull().default("standard"),
  sourceType: text("source_type").notNull().default("manual"),
  sourceBatchId: text("source_batch_id"),
  note: text("note"),
  ...audit,
}, (t) => [uniqueIndex("product_margin_unique").on(t.storeId, t.period, t.category, t.productName)]);

export const expenseEntries = sqliteTable("expense_entries", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  period: text("period").notNull(),
  category: text("category").notNull(),
  amountCents: integer("amount_cents").notNull(),
  note: text("note"),
  sourceBatchId: text("source_batch_id"),
  ...audit,
});

export const bankTransactions = sqliteTable("bank_transactions", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  businessDate: text("business_date").notNull(),
  summary: text("summary").notNull(),
  incomeCents: integer("income_cents").notNull().default(0),
  expenseCents: integer("expense_cents").notNull().default(0),
  balanceCents: integer("balance_cents").notNull(),
  sourceBatchId: text("source_batch_id"),
  ...audit,
});

export const counterparties = sqliteTable("counterparties", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  kind: text("kind").notNull(),
  period: text("period").notNull().default("2026-06"),
  name: text("name").notNull(),
  originalCents: integer("original_cents").notNull(),
  settledCents: integer("settled_cents").notNull().default(0),
  dueDate: text("due_date"),
  status: text("status").notNull(),
  note: text("note"),
  ...audit,
});

export const periodCloses = sqliteTable("period_closes", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  period: text("period").notNull(),
  status: text("status").notNull(),
  closedAt: text("closed_at"),
  closedBy: text("closed_by"),
  note: text("note"),
  ...audit,
}, (t) => [uniqueIndex("close_store_period").on(t.storeId, t.period)]);

export const importBatches = sqliteTable("import_batches", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  fileName: text("file_name").notNull(),
  fileHash: text("file_hash").notNull(),
  status: text("status").notNull(),
  sheetCount: integer("sheet_count").notNull(),
  errorCount: integer("error_count").notNull().default(0),
  summaryJson: text("summary_json").notNull(),
  ...audit,
}, (t) => [uniqueIndex("import_store_hash").on(t.storeId, t.fileHash)]);

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  payloadJson: text("payload_json").notNull(),
  ...audit,
});
