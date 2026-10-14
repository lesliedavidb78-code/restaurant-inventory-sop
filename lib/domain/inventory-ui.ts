export function eventNeedsPurchasePrice(eventType: string) {
  return eventType === "purchase";
}

export function pageSlice<T>(rows: T[], requestedPage: number, pageSize: number) {
  const safeSize = [10, 20, 50].includes(pageSize) ? pageSize : 20;
  const totalPages = Math.max(1, Math.ceil(rows.length / safeSize));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), totalPages);
  const start = (page - 1) * safeSize;
  return { rows: rows.slice(start, start + safeSize), page, pageSize: safeSize, totalPages, totalRows: rows.length };
}

export function weightedAverageCostCents(rows: { quantity: number; averageCostCents: number }[]) {
  const stockedRows = rows.filter((row) => row.quantity > 0);
  const totalQuantity = stockedRows.reduce((sum, row) => sum + row.quantity, 0);
  if (totalQuantity <= 0) return 0;
  return stockedRows.reduce((sum, row) => sum + row.quantity * row.averageCostCents, 0) / totalQuantity;
}

export function searchInventoryItems<T extends { name: string; sku: string; category: string; specification?: string }>(items: T[], keyword: string, limit = Number.POSITIVE_INFINITY) {
  const normalized = keyword.trim().toLowerCase();
  const matches = normalized
    ? items.filter((item) => `${item.name} ${item.sku} ${item.category} ${item.specification ?? ""}`.toLowerCase().includes(normalized))
    : items;
  return matches.slice(0, limit);
}

export function searchStockRecords<T extends { itemName: string; sku: string; eventType: string; businessDate: string; warehouseName: string; note?: string | null }>(records: T[], keyword: string) {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return records;
  return records.filter((record) => `${record.itemName} ${record.sku} ${record.eventType} ${record.businessDate} ${record.warehouseName} ${record.note ?? ""}`.toLowerCase().includes(normalized));
}
