"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { businessDate } from "@/lib/domain/business-date";
import { AlertTriangle, BookOpenCheck, Boxes, ClipboardList, Download, FileSpreadsheet, FileText, PackagePlus, Pencil, Save, Search, SearchCheck, Trash2, Truck, Warehouse, X } from "lucide-react";
import { RecipeManager } from "@/components/recipe-manager";
import { ReconciliationDesk } from "@/components/reconciliation-desk";
import { PurchasingDesk } from "@/components/purchasing-desk";
import { InventoryReportsDesk } from "@/components/inventory-reports-desk";
import type { getDashboard } from "@/lib/services";
import { eventNeedsPurchasePrice, pageSlice, searchInventoryItems, searchStockRecords, weightedAverageCostCents } from "@/lib/domain/inventory-ui";
import { resolveCategorySettings } from "@/lib/domain/replenishment";
import { nextSkuForName } from "@/lib/domain/sku";
import { parsePackageSpecification } from "@/lib/domain/package-spec";

type DashboardData = Awaited<ReturnType<typeof getDashboard>>;
type Page = "overview" | "operation" | "goods" | "recipe" | "reconcile" | "purchasing" | "reports" | "excel" | "word";
type OverviewView = "stock" | "cleanup";
type ItemEditDraft = {
  id: string; name: string; sku: string; specification: string; category: string;
  purchaseUom: string; stockUom: string; unitsPerPurchase: string;
  unitNetContent: string; contentUom: string; warningDays: string;
  targetDays: string; replenishmentFactor: string;
};
type ActionDialog = { title: string; detail: string; tone: "success" | "error" };
type StockEntryDraft = {
  eventType: string; businessDate: string; warehouseId: string; quantity: string;
  quantityUom: "stock" | "purchase"; itemId: string; itemKeyword: string; unitCost: string; note: string;
};
const stockEntryDraftKey = "store-inventory-stock-entry-draft-v1";
const stockRequestDraftKey = "store-inventory-stock-requests-v1";
const blankStockEntry = (warehouseId: string): StockEntryDraft => ({ eventType: "purchase", businessDate: businessDate(), warehouseId, quantity: "", quantityUom: "stock", itemId: "", itemKeyword: "", unitCost: "", note: "" });
const textValue = (value: FormDataEntryValue | null) => String(value ?? "").trim();
const positiveNumber = (value: FormDataEntryValue | null) => textValue(value) !== "" && Number.isFinite(Number(value)) && Number(value) > 0;
const nonNegativeNumber = (value: FormDataEntryValue | null) => textValue(value) !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
const today = () => businessDate();
const qty = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
const money = (value: number) => `¥${(value / 100).toFixed(2)}`;
const unitPrice = (cents: number) => new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 6, useGrouping: false }).format(cents / 100);

const eventOptions = [
  ["purchase", "采购入库"], ["sale", "销售出库"], ["issue", "领料出库"], ["issue_return", "退料入库"],
  ["waste", "报损出库"], ["adjustment", "盘点调整"], ["transfer_in", "调拨入库"], ["transfer_out", "调拨出库"],
] as const;

export function InventoryDesk({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState(initialData);
  const [page, setPage] = useState<Page>("overview");
  const [overviewView, setOverviewView] = useState<OverviewView>("stock");
  const [search, setSearch] = useState("");
  const [warningOnly, setWarningOnly] = useState(false);
  const [overviewCategory, setOverviewCategory] = useState("");
  const [overviewPage, setOverviewPage] = useState(1);
  const [overviewPageSize, setOverviewPageSize] = useState(20);
  const [cleanupPage, setCleanupPage] = useState(1);
  const [cleanupPageSize, setCleanupPageSize] = useState(20);
  const [recordPage, setRecordPage] = useState(1);
  const [recordPageSize, setRecordPageSize] = useState(20);
  const [itemManagerPage, setItemManagerPage] = useState(1);
  const [itemManagerPageSize, setItemManagerPageSize] = useState(20);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [wordPreview, setWordPreview] = useState<any>(null);
  const [excelPreview, setExcelPreview] = useState<any>(null);
  const [includeClosingStock, setIncludeClosingStock] = useState(true);
  const [stockEntry, setStockEntry] = useState<StockEntryDraft>(() => blankStockEntry(initialData.warehouses[0]?.id ?? ""));
  const [stockDraftReady, setStockDraftReady] = useState(false);
  const itemKeyword = stockEntry.itemKeyword;
  const selectedItemId = stockEntry.itemId;
  const setItemKeyword = (itemKeyword: string) => setStockEntry((current) => ({ ...current, itemKeyword }));
  const setSelectedItemId = (itemId: string) => setStockEntry((current) => ({ ...current, itemId }));
  const [productMenuOpen, setProductMenuOpen] = useState(false);
  const [recordKeyword, setRecordKeyword] = useState("");
  const [itemManagerKeyword, setItemManagerKeyword] = useState("");
  const stockEventType = stockEntry.eventType;
  const stockQuantity = stockEntry.quantity;
  const unitCostInput = stockEntry.unitCost;
  const setStockEventType = (eventType: string) => setStockEntry((current) => ({ ...current, eventType }));
  const setStockQuantity = (quantity: string) => setStockEntry((current) => ({ ...current, quantity }));
  const setUnitCostInput = (unitCost: string) => setStockEntry((current) => ({ ...current, unitCost }));
  const [confirmAbnormalPrice, setConfirmAbnormalPrice] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [editUnitCost, setEditUnitCost] = useState("");
  const [editBusinessDate, setEditBusinessDate] = useState("");
  const [itemCategory, setItemCategory] = useState("公司产品");
  const [newItemCategory, setNewItemCategory] = useState("");
  const [itemName, setItemName] = useState("");
  const [itemSku, setItemSku] = useState("");
  const [skuManuallyEdited, setSkuManuallyEdited] = useState(false);
  const [itemWarningDays, setItemWarningDays] = useState("15");
  const [itemTargetDays, setItemTargetDays] = useState("30");
  const [itemFactor, setItemFactor] = useState("1.2");
  const [itemEditDraft, setItemEditDraft] = useState<ItemEditDraft | null>(null);
  const [itemDeleteTarget, setItemDeleteTarget] = useState<DashboardData["items"][number] | null>(null);
  const [stockDeleteTarget, setStockDeleteTarget] = useState<DashboardData["stockRecords"][number] | null>(null);
  const [actionDialog, setActionDialog] = useState<ActionDialog | null>(null);
  const [cleanupTarget, setCleanupTarget] = useState<DashboardData["stock"][number] | null>(null);
  const [cleanupConfirmTarget, setCleanupConfirmTarget] = useState<{ row: DashboardData["stock"][number]; keepVisible: boolean } | null>(null);
  const [quickReceiveTarget, setQuickReceiveTarget] = useState<DashboardData["stock"][number] | null>(null);
  const [quickReceiveQuantity, setQuickReceiveQuantity] = useState("");
  const [quickReceiveDate, setQuickReceiveDate] = useState(today());
  const [quickReceivePrice, setQuickReceivePrice] = useState("");
  const wordFileRef = useRef<HTMLInputElement>(null);
  const excelFileRef = useRef<HTMLInputElement>(null);
  const stockPostBusy = useRef(false);
  const stockRequests = useRef<Record<string, { fingerprint: string; requestId: string }>>({});

  useEffect(() => {
    try {
      const restored = JSON.parse(window.sessionStorage.getItem(stockEntryDraftKey) || "null") as Partial<StockEntryDraft> | null;
      if (restored && typeof restored === "object") setStockEntry({ ...blankStockEntry(initialData.warehouses[0]?.id ?? ""), ...restored });
    } catch { /* 损坏的草稿不影响录入；保留安全默认值。 */ }
    setStockDraftReady(true);
  }, []);

  useEffect(() => {
    if (!stockDraftReady) return;
    try { window.sessionStorage.setItem(stockEntryDraftKey, JSON.stringify(stockEntry)); } catch { /* 存储空间不足时保留当前会话中的整张单据。 */ }
  }, [stockEntry, stockDraftReady]);

  function writeDeleteDiagnostic(event: "delete_started" | "delete_api_success" | "delete_interaction_released" | "delete_refresh_started" | "delete_refresh_finished" | "delete_refresh_failed" | "delete_finally" | "open_item_editor" | "open_record_editor" | "navigate", detail?: string) {
    // 诊断请求不参与 busy 状态，也不影响任何正常操作；失败时静默忽略。
    void fetch("/api/ui-diagnostics", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, page, busy, detail }),
    }).catch(() => undefined);
  }

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("inventory-last-replenishment") || "null") as { category?: string; warningDays?: number; targetDays?: number; factor?: number } | null;
      if (!saved?.category) return;
      setItemCategory(saved.category);
      setItemWarningDays(String(saved.warningDays ?? 15));
      setItemTargetDays(String(saved.targetDays ?? 30));
      setItemFactor(String(saved.factor ?? 1.2));
    } catch { /* 保留安全默认值 */ }
  }, []);

  useEffect(() => {
    // 离开当前页面时清理行内编辑状态，避免返回页面后旧状态继续锁住操作。
    setEditingRecordId("");
    setEditQuantity("");
    setEditUnitCost("");
    setEditBusinessDate("");
    setItemEditDraft(null);
    setItemDeleteTarget(null);
    setStockDeleteTarget(null);
    setActionDialog(null);
    setCleanupTarget(null);
    setCleanupConfirmTarget(null);
    setProductMenuOpen(false);
  }, [page]);

  /**
   * 商品删除、库存删除和库存清理都会改变当前表格的行集合。
   * 这些动作结束后，不能保留任何指向旧行的编辑状态或全屏对话框；
   * 否则旧遮罩或全局 busy 状态会让用户误以为整个页面不能点击。
   */
  function resetTransientInteractionState() {
    setEditingRecordId("");
    setEditQuantity("");
    setEditUnitCost("");
    setEditBusinessDate("");
    setItemEditDraft(null);
    setCleanupTarget(null);
    setCleanupConfirmTarget(null);
    setStockDeleteTarget(null);
    setProductMenuOpen(false);
  }

  const lowStock = data.stock.filter((row) => row.isWarning);
  const stockedCount = data.stock.filter((row) => row.quantity > 0).length;
  const stockValue = data.stock.reduce((sum, row) => sum + (row.value_cents ?? row.quantity * row.averageCostCents), 0);
  const stockRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return data.stock.filter((row) => (!warningOnly || row.isWarning) && (!overviewCategory || row.category === overviewCategory) && (!keyword || `${row.itemName} ${row.sku} ${row.category}`.toLowerCase().includes(keyword)));
  }, [data.stock, search, warningOnly, overviewCategory]);
  const pagedStock = pageSlice(stockRows, overviewPage, overviewPageSize);
  const cleanupRows = useMemo(() => data.stock.filter((row) => row.quantity > 0), [data.stock]);
  const pagedCleanup = pageSlice(cleanupRows, cleanupPage, cleanupPageSize);
  const categoryOptions = useMemo(() => Array.from(new Set([
    ...data.categorySettings.map((profile) => profile.name),
    ...data.items.map((item) => item.category),
  ].filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN")), [data.categorySettings, data.items]);
  const filteredItems = useMemo(() => {
    return searchInventoryItems(data.items, itemKeyword, 40);
  }, [data.items, itemKeyword]);
  const visibleStockRecords = useMemo(() => searchStockRecords(data.stockRecords, recordKeyword), [data.stockRecords, recordKeyword]);
  const visibleManagedItems = useMemo(() => searchInventoryItems(data.items, itemManagerKeyword), [data.items, itemManagerKeyword]);
  const pagedStockRecords = pageSlice(visibleStockRecords, recordPage, recordPageSize);
  const pagedManagedItems = pageSlice(visibleManagedItems, itemManagerPage, itemManagerPageSize);
  const averageCostByItem = useMemo(() => {
    const rowsByItem = new Map<string, { quantity: number; averageCostCents: number }[]>();
    for (const row of data.stock) {
      const current = rowsByItem.get(row.item_id) ?? [];
      current.push(row);
      rowsByItem.set(row.item_id, current);
    }
    return new Map(Array.from(rowsByItem, ([itemId, rows]) => [itemId, weightedAverageCostCents(rows)]));
  }, [data.stock]);
  const selectedItem = data.items.find((item) => item.id === selectedItemId);
  const selectedStock = data.stock.find((row) => row.item_id === selectedItemId && row.warehouse_id === stockEntry.warehouseId && row.quantity > 0);
  const needsPurchasePrice = eventNeedsPurchasePrice(stockEventType);
  const enteredUnitCostCents = needsPurchasePrice && unitCostInput !== "" ? Number(unitCostInput) * 100 : undefined;
  const totalPurchaseCents = Number(stockQuantity) > 0 && enteredUnitCostCents !== undefined ? Math.round(Number(stockQuantity) * enteredUnitCostCents) : 0;
  const enteredStockUnitCostCents = enteredUnitCostCents === undefined ? undefined : enteredUnitCostCents / (stockEntry.quantityUom === "purchase" ? selectedItem?.unitsPerPurchase ?? 1 : 1);
  const abnormalPrice = needsPurchasePrice && enteredStockUnitCostCents !== undefined && selectedStock?.averageCostCents && (enteredStockUnitCostCents > selectedStock.averageCostCents * 2 || enteredStockUnitCostCents < selectedStock.averageCostCents / 2);

  useEffect(() => {
    if (skuManuallyEdited) return;
    setItemSku(itemName.trim() ? nextSkuForName(itemName, data.items.map((item) => item.sku)) : "");
  }, [data.items, itemName, skuManuallyEdited]);

  function applyCategoryDefaults(category: string) {
    const next = resolveCategorySettings(category, data.categorySettings, {
      warningDays: Number(itemWarningDays) || 15,
      targetDays: Number(itemTargetDays) || 30,
      factor: Number(itemFactor) || 1.2,
    });
    setItemWarningDays(String(next.warningDays));
    setItemTargetDays(String(next.targetDays));
    setItemFactor(String(next.factor));
  }

  async function requestJson(url: string, options?: RequestInit) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const result = await response.json();
      if (!response.ok || result?.error) throw new Error(result?.error || "请求失败，请稍后重试。");
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("操作等待超时，已恢复页面操作；请确认数据是否已保存后再重试。");
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function refresh(diagnostic = false) {
    if (diagnostic) writeDeleteDiagnostic("delete_refresh_started");
    const next = await requestJson(`/api/dashboard?period=${data.period}`, { cache: "no-store" });
    setData(next);
    if (diagnostic) writeDeleteDiagnostic("delete_refresh_finished", `records=${next.stockRecords.length}`);
  }

  async function postStock(scope: string, body: Record<string, unknown>) {
    if (stockPostBusy.current) throw new Error("上一笔库存操作正在保存，请稍候。");
    const fingerprint = JSON.stringify(body);
    let requests = stockRequests.current;
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(stockRequestDraftKey) || "null");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) requests = stored;
    } catch { /* 存储不可用时保留内存中的重试键。 */ }
    const previous = requests[scope];
    const requestId = previous?.fingerprint === fingerprint ? previous.requestId : window.crypto.randomUUID();
    requests[scope] = { fingerprint, requestId };
    stockRequests.current = requests;
    try { window.sessionStorage.setItem(stockRequestDraftKey, JSON.stringify(requests)); } catch { /* 内存幂等键仍有效。 */ }
    stockPostBusy.current = true;
    try {
      const result = await requestJson("/api/stock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, requestId }) });
      // 旧组件的保存回包不能消费返回页面后建立的新请求键。
      try {
        const stored = JSON.parse(window.sessionStorage.getItem(stockRequestDraftKey) || "null");
        if (stored && typeof stored === "object" && !Array.isArray(stored)) requests = stored;
      } catch { /* 保留内存回退。 */ }
      if (requests[scope]?.requestId === requestId) delete requests[scope];
      stockRequests.current = requests;
      try { window.sessionStorage.setItem(stockRequestDraftKey, JSON.stringify(requests)); } catch { /* 已成功的操作不因存储失败变为业务失败。 */ }
      return result;
    } finally { stockPostBusy.current = false; }
  }

  function openQuickReceive(row: DashboardData["stock"][number]) {
    setQuickReceiveTarget(row);
    setQuickReceiveQuantity("");
    setQuickReceiveDate(today());
    setQuickReceivePrice(row.averageCostCents > 0 ? String(row.averageCostCents / 100) : "");
  }

  async function submitQuickReceive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quickReceiveTarget || Number(quickReceiveQuantity) <= 0) {
      setMessage("请填写大于 0 的今日收货数量。");
      return;
    }
    try {
      setBusy(true); setMessage("");
      const result = await postStock(`quick:${quickReceiveTarget.item_id}:${quickReceiveTarget.warehouse_id}`, {
        itemId: quickReceiveTarget.item_id, warehouseId: quickReceiveTarget.warehouse_id, eventType: "purchase", businessDate: quickReceiveDate,
        quantity: Number(quickReceiveQuantity), quantityUom: "stock", unitCostCents: quickReceivePrice.trim() === "" ? undefined : Number(quickReceivePrice) * 100,
        note: "库存总览快捷入库",
      });
      setQuickReceiveTarget(null);
      setMessage(`已快速入库。当前成本 ¥${unitPrice(result.averageCostCents)}/${result.stockUom}`);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "快捷入库失败"); }
    finally { setBusy(false); }
  }

  async function submitOverviewInlineStock(row: DashboardData["stock"][number], quantity: number, eventType: "purchase" | "issue" | "sale" | "waste") {
    if (eventType === "purchase" && row.averageCostCents <= 0) {
      setMessage("该商品尚无成本，首次入库请在弹出的窗口填写采购单价。");
      openQuickReceive(row);
      return false;
    }
    try {
      setBusy(true); setMessage("");
      const result = await postStock(`inline:${row.item_id}:${row.warehouse_id}`, {
        itemId: row.item_id, warehouseId: row.warehouse_id, eventType, businessDate: today(), quantity, quantityUom: "stock",
        unitCostCents: eventType === "purchase" ? row.averageCostCents : undefined,
        note: eventType === "purchase" ? "库存总览直接录入今日收货" : `库存总览直接${eventName(eventType)}`,
      });
      setMessage(`已按今天${eventType === "purchase" ? "入库" : eventName(eventType)} ${qty(quantity)} ${row.uom}。当前成本 ¥${unitPrice(result.averageCostCents)}/${result.stockUom}`);
      // 录入已完成即可恢复操作，后台刷新只用于同步全部汇总，不能再阻塞用户继续录入。
      void refresh().catch((error) => setMessage(error instanceof Error ? `${error.message}；请稍后刷新总览。` : "后台刷新失败，请稍后刷新总览。"));
      return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "库存直接录入失败"); return false; }
    finally { setBusy(false); }
  }

  function showRequiredFields(form: HTMLFormElement, checks: { name: string; label: string; valid: boolean }[]) {
    const missing = checks.filter((check) => {
      const element = form.elements.namedItem(check.name);
      const nativeInvalid = element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? !element.checkValidity() : false;
      return !check.valid || nativeInvalid;
    });
    if (!missing.length) return false;
    setMessage(`请补充：${missing.map((check) => check.label).join("、")}。红框位置需要填写或重新选择。`);
    const friendlyNames: Record<string, string> = { eventType: "业务类型", businessDate: "业务日期", itemSearch: "商品（请输入关键词并选择下方结果）", itemId: "商品", warehouseId: "仓库", quantity: "数量（请输入大于 0 的数字）", quantityUom: "录入单位", unitCost: "采购单价（请输入数字）", sku: "商品 SKU（只允许字母、数字、短横线和下划线）", name: "商品名称", category: "分类", newCategory: "新分类名称", purchaseUom: "采购单位", stockUom: "最小库存单位", unitsPerPurchase: "采购换算数量（请输入大于 0 的数字）", unitNetContent: "净含量（请输入大于 0 的数字）", contentUom: "净含量单位", warningDays: "预警天数（请输入 0 或正数）", targetDays: "目标库存天数（请输入大于 0 的数字）", replenishmentFactor: "补货系数（请输入大于 0 的数字）" };
    setMessage(`请检查：${missing.map((check) => friendlyNames[check.name] ?? check.label).join("、")}。红框已闪烁并定位到第一个问题。`);
    const first = form.elements.namedItem(missing[0].name);
    missing.forEach(({ name }) => {
      const element = form.elements.namedItem(name);
      if (element instanceof HTMLElement) {
        element.classList.remove("field-error-pulse");
        void element.offsetWidth;
        element.classList.add("field-error-pulse");
        window.setTimeout(() => element.classList.remove("field-error-pulse"), 1500);
      }
    });
    if (first instanceof HTMLElement) first.focus();
    return true;
  }

  async function submitStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stockPostBusy.current || busy) return;
    setBusy(true); setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (abnormalPrice && !confirmAbnormalPrice) {
      setMessage("采购单价与当前平均成本差异较大。请确认填写的是每斤、每包或每箱的单价，而不是本次总金额。");
      setBusy(false);
      return;
    }
    if (showRequiredFields(formElement, [
      { name: "eventType", label: "业务类型", valid: Boolean(form.get("eventType")) },
      { name: "businessDate", label: "业务日期", valid: /^\d{4}-\d{2}-\d{2}$/.test(String(form.get("businessDate") ?? "")) },
      { name: "itemSearch", label: "商品", valid: Boolean(form.get("itemId")) },
      { name: "warehouseId", label: "仓库", valid: Boolean(form.get("warehouseId")) },
      { name: "quantity", label: "数量", valid: Number(form.get("quantity")) > 0 },
      { name: "quantityUom", label: "录入单位", valid: ["stock", "purchase"].includes(String(form.get("quantityUom"))) },
    ])) { setBusy(false); return; }
    const body = {
      itemId: stockEntry.itemId, warehouseId: stockEntry.warehouseId, eventType: stockEntry.eventType,
      businessDate: stockEntry.businessDate, quantity: Number(stockEntry.quantity), quantityUom: stockEntry.quantityUom,
      unitCostCents: needsPurchasePrice && stockEntry.unitCost !== "" ? Number(stockEntry.unitCost) * 100 : undefined, note: stockEntry.note,
    };
    try {
      const result = await postStock("operation", body);
      setMessage(`已记入库存。当前成本 ¥${unitPrice(result.averageCostCents)}/${result.stockUom}`);
      setStockEntry(blankStockEntry(data.warehouses[0]?.id ?? "")); setConfirmAbnormalPrice(false);
      void refresh().catch((error) => setMessage(`库存已保存；${error instanceof Error ? error.message : "总览刷新失败"}，请稍后刷新。`));
    } catch (error) { setMessage(error instanceof Error ? error.message : "库存操作失败"); }
    finally { setBusy(false); }
  }

  async function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const category = String(form.get("category")) === "__new__" ? String(form.get("newCategory") ?? "").trim() : String(form.get("category") ?? "").trim();
    const sku = itemSku.trim() || nextSkuForName(String(form.get("name") ?? ""), data.items.map((item) => item.sku));
    if (showRequiredFields(formElement, [
      { name: "sku", label: "商品 SKU", valid: Boolean(sku) },
      { name: "name", label: "商品名称", valid: Boolean(String(form.get("name") ?? "").trim()) },
      { name: String(form.get("category")) === "__new__" ? "newCategory" : "category", label: "分类", valid: Boolean(category) },
      { name: "purchaseUom", label: "采购单位", valid: Boolean(String(form.get("purchaseUom") ?? "").trim()) },
      { name: "stockUom", label: "最小库存单位", valid: Boolean(String(form.get("stockUom") ?? "").trim()) },
      { name: "unitsPerPurchase", label: "采购单位换算数量", valid: Number(form.get("unitsPerPurchase")) > 0 },
      { name: "unitNetContent", label: "每最小单位净含量", valid: Number(form.get("unitNetContent")) > 0 },
      { name: "contentUom", label: "净含量单位", valid: Boolean(String(form.get("contentUom") ?? "").trim()) },
      { name: "warningDays", label: "预警天数", valid: Number(form.get("warningDays")) >= 0 },
      { name: "targetDays", label: "目标库存天数", valid: Number(form.get("targetDays")) > 0 },
      { name: "replenishmentFactor", label: "补货系数", valid: Number(form.get("replenishmentFactor")) > 0 },
    ])) { setBusy(false); return; }
    const body = {
      sku, name: String(form.get("name")), specification: String(form.get("specification") || ""), category, purchaseUom: String(form.get("purchaseUom")),
      stockUom: String(form.get("stockUom")), unitsPerPurchase: Number(form.get("unitsPerPurchase")), unitNetContent: Number(form.get("unitNetContent")),
      contentUom: String(form.get("contentUom")), purchasePriceCents: 0, minimumQty: 0,
      warningDays: Number(form.get("warningDays")), targetDays: Number(form.get("targetDays")), replenishmentFactor: Number(form.get("replenishmentFactor")),
    };
    try {
      const result = await requestJson("/api/master-data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      window.localStorage.setItem("inventory-last-replenishment", JSON.stringify({ category: body.category, warningDays: body.warningDays, targetDays: body.targetDays, factor: body.replenishmentFactor }));
      setMessage(`商品“${body.name}”已建档，SKU 为 ${result.sku ?? body.sku}，可以立即入库。分类和补货参数已保留为下一个商品的默认值。`);
      formElement.reset(); setItemName(""); setItemSku(""); setSkuManuallyEdited(false); setNewItemCategory(""); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "商品建档失败"); }
    finally { setBusy(false); }
  }

  function removeItem(item: DashboardData["items"][number]) {
    setItemDeleteTarget(item);
  }

  async function confirmRemoveItem(item: DashboardData["items"][number]) {
    resetTransientInteractionState();
    setBusy(true); setMessage("");
    try {
      const result = await requestJson("/api/master-data", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id }) });
      // 删除/停用已落库后立即恢复建档输入；总览重算在后台完成，不能锁住商品名称和 SKU。
      setData((current) => ({
        ...current,
        items: current.items.filter((row) => row.id !== item.id),
        stock: current.stock.filter((row) => row.item_id !== item.id),
        // 已停用商品的历史流水必须保留；后台刷新会重新取回完整台账。
        stockRecords: current.stockRecords,
      }));
      setItemDeleteTarget(null);
      setActionDialog({ title: result.mode === "deleted" ? "商品已删除" : "商品已安全停用", detail: result.message, tone: "success" });
      setBusy(false);
      resetTransientInteractionState();
      void refresh().catch(() => setMessage("商品已处理；总览刷新较慢，请稍后刷新页面确认库存。商品建档和库存录入可继续使用。"));
    } catch (error) {
      setItemDeleteTarget(null);
      setActionDialog({ title: "暂不能删除商品", detail: error instanceof Error ? error.message : "商品删除失败，请稍后重试。", tone: "error" });
    }
    finally {
      resetTransientInteractionState();
      setBusy(false);
    }
  }

  function beginEditItem(item: DashboardData["items"][number]) {
    writeDeleteDiagnostic("open_item_editor", `item=${item.id}`);
    setItemEditDraft({
      id: item.id, name: item.name, sku: item.sku, specification: item.specification,
      category: item.category, purchaseUom: item.purchaseUom, stockUom: item.stockUom,
      unitsPerPurchase: String(item.unitsPerPurchase), unitNetContent: String(item.unitNetContent),
      contentUom: item.contentUom, warningDays: String(item.warningDays),
      targetDays: String(item.targetDays), replenishmentFactor: String(item.replenishmentFactor),
    });
    setMessage(`正在修改“${item.name}”的完整商品资料。`);
  }

  function applySpecificationToItemDraft() {
    if (!itemEditDraft) return;
    const parsed = parsePackageSpecification(itemEditDraft.specification, itemEditDraft.purchaseUom || "件", itemEditDraft.stockUom || "件");
    if (!parsed) {
      setActionDialog({ title: "未识别到可拆分的包装规格", detail: "请使用例如“5kg/4袋”“4袋×5kg”的格式，或直接手工填写下面的单位、数量和净含量。" , tone: "error" });
      return;
    }
    setItemEditDraft({ ...itemEditDraft, purchaseUom: parsed.purchaseUom, stockUom: parsed.stockUom, unitsPerPurchase: String(parsed.unitsPerPurchase), unitNetContent: String(parsed.unitNetContent), contentUom: parsed.contentUom });
    setActionDialog({ title: "已按规格填充包装信息", detail: `已识别为：1 ${parsed.purchaseUom} = ${parsed.unitsPerPurchase} ${parsed.stockUom}，每 ${parsed.stockUom} ${parsed.unitNetContent} ${parsed.contentUom}。请核对后保存。`, tone: "success" });
  }

  function closeItemEditor() {
    setItemEditDraft(null);
    setMessage("");
  }

  async function saveItemSettings() {
    if (!itemEditDraft) return;
    const unitsPerPurchase = Number(itemEditDraft.unitsPerPurchase);
    const unitNetContent = Number(itemEditDraft.unitNetContent);
    const warningDays = Number(itemEditDraft.warningDays);
    const targetDays = Number(itemEditDraft.targetDays);
    const replenishmentFactor = Number(itemEditDraft.replenishmentFactor);
    if (!itemEditDraft.name.trim() || !/^[A-Za-z0-9_-]+$/.test(itemEditDraft.sku.trim()) || !itemEditDraft.category.trim() || !itemEditDraft.purchaseUom.trim() || !itemEditDraft.stockUom.trim() || !itemEditDraft.contentUom.trim() || !Number.isFinite(unitsPerPurchase) || unitsPerPurchase <= 0 || !Number.isFinite(unitNetContent) || unitNetContent <= 0 || !Number.isFinite(warningDays) || warningDays < 0 || !Number.isFinite(targetDays) || targetDays <= 0 || !Number.isFinite(replenishmentFactor) || replenishmentFactor <= 0) {
      setActionDialog({ title: "商品资料未保存", detail: "请检查完整商品资料：名称、SKU、分类和单位不能为空；采购换算数量、净含量、目标天数与补货系数必须大于 0。", tone: "error" });
      return;
    }
    setBusy(true); setMessage("");
    try {
      const original = data.items.find((item) => item.id === itemEditDraft.id);
      if (!original) throw new Error("商品不存在，请刷新后重试。");
      const body = { id: itemEditDraft.id, sku: itemEditDraft.sku.trim(), name: itemEditDraft.name.trim(), specification: itemEditDraft.specification.trim(), category: itemEditDraft.category.trim(), purchaseUom: itemEditDraft.purchaseUom.trim(), stockUom: itemEditDraft.stockUom.trim(), unitsPerPurchase, unitNetContent, contentUom: itemEditDraft.contentUom.trim(), purchasePriceCents: original.purchasePriceCents, minimumQty: original.minimumQty, warningDays, targetDays, replenishmentFactor };
      await requestJson("/api/master-data", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      // 商品资料已落库后立即同步当前页面并解除 busy；不能等待整页总览重算，
      // 否则用户会看到“正在保存”并误以为没有保存成功。
      setData((current) => ({
        ...current,
        items: current.items.map((item) => item.id === body.id ? { ...item, ...body } : item),
        stock: current.stock.map((row) => row.item_id === body.id ? {
          ...row, itemName: body.name, sku: body.sku.toUpperCase(), category: body.category,
          purchaseUom: body.purchaseUom, unitsPerPurchase: body.unitsPerPurchase,
          unitNetContent: body.unitNetContent, contentUom: body.contentUom, uom: body.stockUom,
          warningDays: body.warningDays, targetDays: body.targetDays, replenishmentFactor: body.replenishmentFactor,
        } : row),
        stockRecords: current.stockRecords.map((row) => row.itemId === body.id ? {
          ...row, itemName: body.name, sku: body.sku.toUpperCase(), purchaseUom: body.purchaseUom, stockUom: body.stockUom,
        } : row),
      }));
      setItemEditDraft(null);
      setActionDialog({ title: "商品资料已保存", detail: `“${body.name}”已保存。总览与历史记录正在后台刷新，期间仍可继续录入和编辑。`, tone: "success" });
      void refresh().catch(() => setMessage("商品资料已保存；总览刷新较慢，请稍后刷新页面确认。"));
    } catch (error) {
      setActionDialog({ title: "商品资料未保存", detail: error instanceof Error ? error.message : "商品修改失败，请稍后重试。", tone: "error" });
    }
    finally { setBusy(false); }
  }

  function chooseCleanup(row: DashboardData["stock"][number], keepVisible: boolean) {
    setCleanupTarget(null);
    setCleanupConfirmTarget({ row, keepVisible });
  }

  async function clearCurrentStock(row: DashboardData["stock"][number], keepVisible: boolean) {
    if (row.quantity <= 0) return;
    resetTransientInteractionState();
    setBusy(true); setMessage("");
    try {
      const result = await requestJson("/api/inventory-cleanup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemId: row.item_id, warehouseId: row.warehouse_id, businessDate: today(), keepVisible }) });
      setData((current) => ({
        ...current,
        stock: current.stock.flatMap((stockRow) => {
          if (stockRow.item_id !== row.item_id || stockRow.warehouse_id !== row.warehouse_id) return [stockRow];
          return keepVisible ? [{ ...stockRow, quantity: 0, value_cents: 0, isWarning: false }] : [];
        }),
      }));
      setCleanupConfirmTarget(null);
      setActionDialog({
        title: "库存已清理",
        detail: keepVisible
          ? `已清理“${row.itemName}” ${qty(row.quantity)} ${row.uom}；商品仍会显示，可再次入库。`
          : `已清理并隐藏“${row.itemName}”；历史账已保留，不再出现在商品库存和预警中。`,
        tone: "success",
      });
      setBusy(false);
      resetTransientInteractionState();
      void refresh().catch(() => setMessage("库存已清理；总览刷新较慢，请稍后刷新页面确认。其他录入和编辑可继续使用。"));
    } catch (error) {
      setCleanupConfirmTarget(null);
      setActionDialog({ title: "库存暂未清理", detail: error instanceof Error ? error.message : "库存清理失败，请稍后重试。", tone: "error" });
    }
    finally {
      resetTransientInteractionState();
      setBusy(false);
    }
  }

  function deleteStockRecord(record: DashboardData["stockRecords"][number]) {
    setStockDeleteTarget(record);
  }

  async function confirmDeleteStockRecord(record: DashboardData["stockRecords"][number]) {
    resetTransientInteractionState();
    writeDeleteDiagnostic("delete_started", `record=${record.id}`);
    setBusy(true); setMessage("");
    try {
      const result = await requestJson("/api/stock-records", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: record.id }) });
      writeDeleteDiagnostic("delete_api_success", `record=${record.id}`);
      // 删除已经由接口提交成功；总览重算在大账本上可能较慢，不能让它继续锁住所有编辑按钮。
      setData((current) => ({ ...current, stockRecords: current.stockRecords.filter((row) => row.id !== record.id) }));
      setStockDeleteTarget(null);
      setActionDialog({ title: "库存记录已删除", detail: `${result.message}。当前库存正在后台重新计算，您现在可以继续录入或编辑。`, tone: "success" });
      setBusy(false);
      resetTransientInteractionState();
      writeDeleteDiagnostic("delete_interaction_released", `record=${record.id}`);
      void refresh(true).catch((error) => {
        writeDeleteDiagnostic("delete_refresh_failed", error instanceof Error ? error.message : "unknown");
        setMessage(`${result.message}；总览刷新较慢，请稍后刷新页面确认库存。录入和编辑可继续使用。`);
      });
    } catch (error) {
      setStockDeleteTarget(null);
      setActionDialog({ title: "暂不能删除库存记录", detail: error instanceof Error ? error.message : "删除库存记录失败，请稍后重试。", tone: "error" });
    }
    finally {
      // 无论删除成功、接口返回错误或刷新超时，都必须恢复可编辑状态。
      setBusy(false);
      resetTransientInteractionState();
      writeDeleteDiagnostic("delete_finally");
    }
  }

  function beginEditPurchaseRecord(record: DashboardData["stockRecords"][number]) {
    writeDeleteDiagnostic("open_record_editor", `record=${record.id}`);
    setEditingRecordId(record.id);
    setEditQuantity(String(record.inputQuantity ?? Math.abs(record.quantityChange)));
    setEditUnitCost(String((record.inputUnitCostCents ?? record.unitCostCents) / 100));
    setEditBusinessDate(record.businessDate);
    setMessage(`正在修改“${record.itemName}”的采购记录。请修改后点击“保存修改”。`);
  }

  function cancelEditPurchaseRecord() {
    setEditingRecordId("");
    setEditQuantity("");
    setEditUnitCost("");
    setEditBusinessDate("");
    setMessage("");
  }

  async function savePurchaseRecord(record: DashboardData["stockRecords"][number]) {
    const quantity = Number(editQuantity);
    const unitCost = Number(editUnitCost);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(editBusinessDate)) {
      setMessage("请检查修改内容：数量必须大于 0，采购单价必须是 0 或正数，日期格式应为年-月-日。");
      return;
    }
    setBusy(true); setMessage("");
    try {
      const quantityUom = record.quantityUom ?? ((record.displayUom ?? record.inputUom) === record.purchaseUom ? "purchase" : "stock");
      const result = await requestJson("/api/stock-records", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: record.id, quantity, quantityUom, unitCostCents: unitCost * 100, businessDate: editBusinessDate }) });
      setEditingRecordId(""); setMessage(result.message); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "修改采购记录失败"); }
    finally { setBusy(false); }
  }

  async function previewWord(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy(true); setMessage(""); setWordPreview(null);
    try {
      const form = new FormData(); form.append("file", file);
      const result = await requestJson("/api/word-import/preview", { method: "POST", body: form });
      setWordPreview(result);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Word 解析失败"); }
    finally { setBusy(false); }
  }

  async function commitWord() {
    if (!wordPreview) return; setBusy(true); setMessage("");
    try {
      const result = await requestJson("/api/word-import/commit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(wordPreview) });
      const summary = result.duplicate ? "该 Word 已成功导入过，本次没有重复写入。" : `Word 导入完成：新增 ${result.productCount} 个商品，复用 ${result.skipped ?? 0} 个已有商品，写入 ${result.stockCount} 条进出库记录。`;
      setMessage(summary); setActionDialog({ title: "Word 导入结果", detail: summary, tone: "success" });
      setWordPreview(null); if (wordFileRef.current) wordFileRef.current.value = ""; await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Word 导入失败"); }
    finally { setBusy(false); }
  }

  async function previewExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy(true); setMessage(""); setExcelPreview(null);
    try {
      const form = new FormData(); form.append("file", file);
      const result = await requestJson("/api/inventory-excel/preview", { method: "POST", body: form });
      setExcelPreview(result);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Excel 解析失败"); }
    finally { setBusy(false); }
  }

  async function commitExcel() {
    if (!excelPreview) return; setBusy(true); setMessage("");
    try {
      const result = await requestJson("/api/inventory-excel/commit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ preview: excelPreview, includeClosingStock }) });
      const summary = result.duplicate ? "该 Excel 已成功导入过，本次没有重复写入。" : `Excel 导入完成：新增 ${result.productCount} 个商品，复用 ${result.skipped ?? 0} 个已有商品；写入 ${result.purchaseCount ?? 0} 条采购入库，${result.closingCount} 条 ${excelPreview.closingDate} 初始结余。`;
      const warnings = (result.warnings ?? []) as string[];
      setMessage(`${summary}${warnings.length ? ` ${warnings.length} 项需核对，请查看导入结果。` : ""}`);
      setActionDialog({ title: "Excel 导入结果", detail: `${summary}${warnings.length ? `\n需核对：\n${warnings.join("\n")}` : ""}`, tone: "success" });
      setExcelPreview(null); if (excelFileRef.current) excelFileRef.current.value = ""; await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Excel 导入失败"); }
    finally { setBusy(false); }
  }

  return <div className="inventory-shell">
    <header className="inventory-header"><div><strong>门店进销存系统</strong><span>单机版 · 不需要登录</span></div><div className="inventory-store"><Warehouse size={17}/>{data.warehouses[0]?.name ?? "门店总仓"}</div></header>
    <aside className="inventory-nav">
      <button className={page === "overview" ? "active" : ""} onClick={() => setPage("overview")}><Boxes size={18}/>库存总览</button>
      <button className={page === "operation" ? "active" : ""} onClick={() => setPage("operation")}><ClipboardList size={18}/>库存作业</button>
      <button className={page === "goods" ? "active" : ""} onClick={() => setPage("goods")}><PackagePlus size={18}/>商品建档</button>
      <button className={page === "recipe" ? "active" : ""} onClick={() => setPage("recipe")}><BookOpenCheck size={18}/>配方管理</button>
      <button className={page === "reconcile" ? "active" : ""} onClick={() => setPage("reconcile")}><SearchCheck size={18}/>库存对账</button>
      <button className={page === "purchasing" ? "active" : ""} onClick={() => setPage("purchasing")}><Truck size={18}/>采购管理</button>
      <button className={page === "reports" ? "active" : ""} onClick={() => setPage("reports")}><ClipboardList size={18}/>库存报表</button>
      <button className={page === "excel" ? "active" : ""} onClick={() => setPage("excel")}><FileSpreadsheet size={18}/>Excel 台账导入</button>
      <button className={page === "word" ? "active" : ""} onClick={() => setPage("word")}><FileText size={18}/>Word 表格导入</button>
    </aside>
    <main className="inventory-main">
      {message && <div className="inventory-notice">{message}</div>}
      {page === "overview" && <>
        {(data.integrityIssues ?? []).length > 0 && <div className="recipe-feedback warning" role="alert"><b>历史账本存在待核对数据</b><p>检测到 {(data.integrityIssues ?? []).reduce((sum, issue) => sum + issue.count, 0)} 项核对记录。本次更新只作异常提醒，没有自动改写旧账；请先备份账本，再根据原始单据核对。</p><ul>{data.integrityIssues.map((issue) => <li key={issue.kind}>{issue.message}（{issue.count} 项）</li>)}</ul></div>}
        <div className="inventory-title"><div><h1>库存总览</h1><p>查看现存、成本和需要处理的低库存商品。</p></div><div className="title-actions"><a className="secondary" href="/api/inventory-export"><Download size={17}/>导出 Excel</a><button className="primary" onClick={() => setPage("operation")}><Truck size={17}/>新增库存单</button></div></div>
        <section className="inventory-metrics"><Metric label="库存商品" value={`${data.stock.length} 种`} note="当前商品台账"/><Metric label="库存预警" value={`${lowStock.length} 项`} note="低于动态预警线" alert/><Metric label="库存估值" value={money(Math.round(stockValue))} note="按移动平均成本"/><Metric label="已建商品" value={`${data.items.length} 个`} note="可直接做入出库"/></section>
        <div className="replenishment-reference"><AlertTriangle size={18}/><div><b>动态预警和建议采购量仅供参考</b><span>系统根据最近最多 3 个完整自然月的正常净出库计算；淡旺季、临时活动、宴席预订、供应周期和门店实际情况可能造成偏差，请结合实际用量确认采购数量。</span></div></div>
        <div className="inventory-view-tabs" role="tablist" aria-label="库存总览功能">
          <button type="button" role="tab" aria-selected={overviewView === "stock"} className={overviewView === "stock" ? "stock-tab active" : "stock-tab"} onClick={() => setOverviewView("stock")}><Boxes size={17}/>商品库存</button>
          <button type="button" role="tab" aria-selected={overviewView === "cleanup"} className={overviewView === "cleanup" ? "cleanup-tab active" : "cleanup-tab"} onClick={() => setOverviewView("cleanup")}><Trash2 size={17}/>库存清理</button>
        </div>
        {overviewView === "stock" && <section className="inventory-card"><div className="stock-tools"><label><Search size={16}/><input value={search} onChange={(e) => { setSearch(e.target.value); setOverviewPage(1); }} placeholder="搜索商品名称或 SKU"/></label><button className={warningOnly ? "filter-on" : ""} onClick={() => { setWarningOnly(!warningOnly); setOverviewPage(1); }}><AlertTriangle size={16}/>{warningOnly ? "显示全部" : `只看预警（${lowStock.length}）`}</button></div><div className="overview-category-filter" aria-label="按商品分类查看"><span>商品分类：</span><button type="button" className={!overviewCategory ? "active" : ""} onClick={() => { setOverviewCategory(""); setOverviewPage(1); }}>全部</button>{categoryOptions.map((category) => <button type="button" key={category} className={overviewCategory === category ? "active" : ""} onClick={() => { setOverviewCategory(category); setOverviewPage(1); }}>{category}</button>)}</div><p className="quick-receive-tip">点击“现存数量”即可直接录入当日入库或出库；日期、仓库、单位会自动带入。首次入库或需改价时可打开详细窗口。</p><StockTable rows={pagedStock.rows} busy={busy} onQuickReceive={openQuickReceive} onInlineQuickStock={submitOverviewInlineStock}/><Pagination page={pagedStock.page} totalPages={pagedStock.totalPages} totalRows={pagedStock.totalRows} pageSize={pagedStock.pageSize} onPageChange={setOverviewPage} onPageSizeChange={(size) => { setOverviewPageSize(size); setOverviewPage(1); }}/></section>}
        {overviewView === "cleanup" && <section className="inventory-card stock-clear-card"><h2>库存清理</h2><p>只显示当前有库存的商品。清理时可选择商品继续显示，或清理后隐藏并停止预警；两种方式都会保留历史账。</p><div className="stock-table-wrap"><table className="stock-table"><thead><tr><th>商品</th><th>当前库存</th><th>仓库</th><th>操作</th></tr></thead><tbody>{pagedCleanup.rows.map((row) => <tr key={`clear-${row.item_id}-${row.warehouse_id}`}><td>{row.itemName}</td><td>{qty(row.quantity)} {row.uom}</td><td>{row.warehouseName}</td><td><button type="button" className="danger-button" disabled={busy} onClick={() => setCleanupTarget(row)}>清理库存</button></td></tr>)}{pagedCleanup.rows.length === 0 && <tr><td colSpan={4} className="empty">暂无需要清理的库存商品</td></tr>}</tbody></table></div><Pagination page={pagedCleanup.page} totalPages={pagedCleanup.totalPages} totalRows={pagedCleanup.totalRows} pageSize={pagedCleanup.pageSize} onPageChange={setCleanupPage} onPageSizeChange={(size) => { setCleanupPageSize(size); setCleanupPage(1); }}/></section>}
      </>}
      {page === "recipe" && <RecipeManager items={data.items}/>} 
      {page === "reconcile" && <ReconciliationDesk items={data.items} warehouses={data.warehouses}/>} 
      {page === "purchasing" && <PurchasingDesk warehouses={data.warehouses}/>} 
      {page === "reports" && <InventoryReportsDesk warehouses={data.warehouses}/>} 
      {page === "operation" && <>
        <div className="inventory-title"><div><h1>库存作业</h1><p>采购入库、销售出库、领料、退料、报损、盘点和调拨都在这里记账。</p></div></div>
        <form className="inventory-form" onSubmit={submitStock} noValidate>
          <fieldset disabled={busy} style={{ display: "contents" }}>
          <label>业务类型<select name="eventType" value={stockEventType} onChange={(event) => { setStockEventType(event.target.value); setUnitCostInput(""); setConfirmAbnormalPrice(false); }}><option value="purchase">采购入库</option><option value="sale">销售出库</option><option value="issue">领料出库</option><option value="issue_return">退料入库</option><option value="waste">报损出库</option><option value="adjustment">盘点调整</option><option value="transfer_in">调拨入库</option><option value="transfer_out">调拨出库</option></select></label>
          <label>业务日期<input type="date" name="businessDate" value={stockEntry.businessDate} onChange={(event) => setStockEntry((current) => ({ ...current, businessDate: event.target.value }))} required/></label>
          <div className="product-combobox full">
            <label htmlFor="stock-item-search">商品（输入名称、分类或 SKU 搜索）</label>
            <div className="product-search-input"><Search size={16}/><input id="stock-item-search" name="itemSearch" autoComplete="off" value={itemKeyword} onFocus={() => setProductMenuOpen(true)} onBlur={() => window.setTimeout(() => setProductMenuOpen(false), 120)} onChange={(event) => { setItemKeyword(event.target.value); setSelectedItemId(""); setProductMenuOpen(true); setConfirmAbnormalPrice(false); }} placeholder="例如：输入“辣椒”“牛肉”后直接选择"/>{selectedItemId && <button type="button" aria-label="清除已选商品" onMouseDown={(event) => event.preventDefault()} onClick={() => { setSelectedItemId(""); setItemKeyword(""); setProductMenuOpen(true); }}><X size={15}/></button>}</div>
            <input type="hidden" name="itemId" value={selectedItemId}/>
            {productMenuOpen && !selectedItemId && <div className="product-search-results" role="listbox">{filteredItems.length ? filteredItems.slice(0, 12).map((item) => <button type="button" role="option" key={item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { setSelectedItemId(item.id); setItemKeyword(`${item.name}（${item.sku}）`); setProductMenuOpen(false); setConfirmAbnormalPrice(false); }}><b>{item.name}</b><span>{item.sku} · {item.category}</span></button>) : <p>没有找到相关商品，请先到“商品建档”新增。</p>}</div>}
            <small>{selectedItem ? `已选择：${selectedItem.name}（${selectedItem.sku}），库存单位 ${selectedItem.stockUom}` : "输入几个字即可联想，不需要滚动整张商品表。"}</small>
          </div>
          <label>仓库<select name="warehouseId" value={stockEntry.warehouseId} onChange={(event) => setStockEntry((current) => ({ ...current, warehouseId: event.target.value }))} required>{data.warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.name}</option>)}</select></label>
          <label>数量<input type="number" name="quantity" min="0.01" step="0.01" required value={stockQuantity} onChange={(event) => setStockQuantity(event.target.value)} placeholder={selectedItem ? `单位：${selectedItem.stockUom}` : "先选择商品"}/></label>
          <label>录入单位<select name="quantityUom" value={stockEntry.quantityUom} onChange={(event) => setStockEntry((current) => ({ ...current, quantityUom: event.target.value as StockEntryDraft["quantityUom"] }))}><option value="stock">最小库存单位</option><option value="purchase">采购单位/整箱</option></select></label>
          {needsPurchasePrice && <label className="price-input">采购单价（人民币 ¥/{(stockEntry.quantityUom === "purchase" ? selectedItem?.purchaseUom : selectedItem?.stockUom) ?? "单位"}）<input type="number" name="unitCost" min="0" step="any" value={unitCostInput} onChange={(event) => { setUnitCostInput(event.target.value); setConfirmAbnormalPrice(false); }} placeholder="填写每斤、每包或每箱的单价，不填总价"/><small>本次总金额：人民币 ¥{(totalPurchaseCents / 100).toFixed(2)} = 数量 × 单价</small></label>}
          {!needsPurchasePrice && <div className="cost-rule-note"><b>出库不填写价格</b><span>系统会按该商品当前的移动平均成本自动计算出库成本。</span></div>}
          {abnormalPrice && <label className="full price-warning"><input type="checkbox" checked={confirmAbnormalPrice} onChange={(event) => setConfirmAbnormalPrice(event.target.checked)}/> 换算后的单价与当前平均成本 ¥{unitPrice(selectedStock!.averageCostCents)}/{selectedItem?.stockUom} 差异较大；我确认这是单价，不是总金额。</label>}
          <label className="full">备注<input name="note" value={stockEntry.note} onChange={(event) => setStockEntry((current) => ({ ...current, note: event.target.value }))} maxLength={200} placeholder="例如：供应商送货单号、盘点原因"/></label>
          <div className="form-action"><button className="primary" disabled={busy}>{busy ? "正在保存…" : "确认记入库存"}</button></div>
          </fieldset>
        </form>
      </>}
      {page === "operation" && <section className="inventory-card record-history"><h2>最近录入记录</h2><p>按实际录入时间倒序，刚录入的记录排在最前。点击“修改”后可直接修改采购数量、单价和日期。</p><div className="stock-tools record-search"><label><Search size={16}/><input value={recordKeyword} onChange={(event) => { setRecordKeyword(event.target.value); setRecordPage(1); }} placeholder="搜索商品、SKU、日期、类型或备注"/></label><span>找到 {visibleStockRecords.length} 条</span></div><div className="stock-table-wrap"><table className="stock-table"><thead><tr><th>日期</th><th>商品</th><th>类型</th><th>数量</th><th>采购单价（人民币）</th><th>仓库</th><th>操作</th></tr></thead><tbody>{pagedStockRecords.rows.map((record) => {
        const editing = editingRecordId === record.id;
        return <tr key={record.id} className={editing ? "editing-record" : ""}>
          <td>{editing ? <input aria-label="修改业务日期" type="date" value={editBusinessDate} onChange={(event) => setEditBusinessDate(event.target.value)}/> : record.businessDate}</td>
          <td>{record.itemName}<br/><small>{record.sku}</small></td>
          <td>{eventName(record.eventType)}</td>
          <td>{editing ? <div className="inline-edit-with-unit"><EditableNumber ariaLabel="修改数量" value={editQuantity} onChange={setEditQuantity} min={0.01} step={0.01}/><span>{record.displayUom ?? record.inputUom ?? record.stockUom}</span></div> : <>{qty(Math.abs(record.inputQuantity ?? record.quantityChange))} {record.displayUom ?? record.inputUom ?? ""}</>}</td>
          <td>{editing ? <div className="inline-edit-price"><span>¥</span><EditableNumber ariaLabel="修改采购单价" value={editUnitCost} onChange={setEditUnitCost} min={0} step={0.000001}/><small>/{record.displayUom ?? record.inputUom ?? record.stockUom}</small></div> : record.eventType === "purchase" ? <>¥{unitPrice(record.inputUnitCostCents ?? record.unitCostCents)}/{record.displayUom ?? record.inputUom ?? record.stockUom}</> : <span className="auto-cost">自动按平均成本</span>}</td>
          <td>{record.warehouseName}</td>
          <td><div className="record-actions">{editing ? <><button type="button" className="save-edit" disabled={busy} onClick={() => savePurchaseRecord(record)}><Save size={14}/>保存修改</button><button type="button" className="cancel-edit" disabled={busy} onClick={cancelEditPurchaseRecord}><X size={14}/>取消</button></> : <>{record.eventType === "purchase" && record.sourceType === "manual" && <button type="button" className="secondary" disabled={busy} onClick={() => beginEditPurchaseRecord(record)}><Pencil size={14}/>修改</button>} {['manual','adjustment'].includes(record.sourceType) && <button type="button" className="danger-button" disabled={busy} onClick={() => deleteStockRecord(record)}>删除</button>}</>}</div></td>
        </tr>;
      })}{pagedStockRecords.rows.length === 0 && <tr><td colSpan={7} className="empty">没有找到符合关键词的录入记录</td></tr>}</tbody></table></div><Pagination page={pagedStockRecords.page} totalPages={pagedStockRecords.totalPages} totalRows={pagedStockRecords.totalRows} pageSize={pagedStockRecords.pageSize} onPageChange={setRecordPage} onPageSizeChange={(size) => { setRecordPageSize(size); setRecordPage(1); }}/></section>}
      {page === "goods" && <>
        <div className="inventory-title"><div><h1>商品建档</h1><p>先定义采购单位和最小库存单位，整箱与拆零都会自动换算。</p></div></div>
        <form className="inventory-form" onSubmit={submitItem} noValidate>
          <label>商品名称<input name="name" required value={itemName} onChange={(event) => setItemName(event.target.value)} placeholder="例如：牛肉卷"/></label><label>商品 SKU<input name="sku" required pattern="[A-Za-z0-9_-]+" title="只允许字母、数字、短横线和下划线" value={itemSku} onChange={(event) => { setItemSku(event.target.value.toUpperCase()); setSkuManuallyEdited(Boolean(event.target.value)); }} placeholder="输入商品名称后自动生成"/><small>系统按拼音首字母自动生成，例如“牛肉”→ NR-001；需要时仍可手动修改。</small></label><label>规格<input name="specification" placeholder="例如：1kg×10袋/箱"/></label><label>分类<select name="category" required value={itemCategory} onChange={(event) => { const value = event.target.value; setItemCategory(value); if (value !== "__new__") applyCategoryDefaults(value); }}><option value="">请选择已有分类</option>{categoryOptions.map((category) => <option value={category} key={category}>{category}</option>)}<option value="__new__">＋ 新增分类</option></select><small>下拉选择历史分类；没有合适分类时选择“新增分类”。</small></label>{itemCategory === "__new__" && <label>新分类名称<input name="newCategory" required value={newItemCategory} onChange={(event) => setNewItemCategory(event.target.value)} placeholder="例如：公司产品"/></label>}
          <label>采购单位<input name="purchaseUom" required defaultValue="箱"/></label><label>最小库存单位<input name="stockUom" required defaultValue="袋"/></label><label>1 个采购单位含多少最小单位<input name="unitsPerPurchase" type="number" min="1" step="0.01" required defaultValue="1"/></label>
          <label>每最小单位净含量<input name="unitNetContent" type="number" min="0.01" step="0.01" required defaultValue="1"/></label><label>净含量单位<input name="contentUom" required defaultValue="kg"/></label>
          <label>预警天数<input name="warningDays" type="number" min="0" step="0.1" required value={itemWarningDays} onChange={(event) => setItemWarningDays(event.target.value)}/><small>当前库存达到或低于这些天的预计用量时预警</small></label><label>目标库存天数<input name="targetDays" type="number" min="0.1" step="0.1" required value={itemTargetDays} onChange={(event) => setItemTargetDays(event.target.value)}/><small>建议采购后希望覆盖的使用天数</small></label><label>补货系数<input name="replenishmentFactor" type="number" min="0.1" step="0.1" required value={itemFactor} onChange={(event) => setItemFactor(event.target.value)}/><small>默认 1.2，表示增加 20% 安全余量</small></label><div className="form-action"><button className="primary" disabled={busy}>{busy ? "正在保存…" : "保存商品"}</button></div>
          <div className="cost-rule-note full"><b>平均成本由入库自动计算</b><span>商品建档不填写价格；首次采购入库后，系统按移动加权平均法形成平均成本。</span></div>
        </form>
      </>}
      {page === "goods" && <section className="inventory-card item-management"><h2>已建商品管理</h2><p>输入关键词可匹配名称、SKU、分类和规格；点击修改可编辑建档时的全部资料，包括采购单位和最小库存单位。平均成本由入库流水自动计算。</p><div className="stock-tools item-manager-search"><label><Search size={16}/><input value={itemManagerKeyword} onChange={(event) => { setItemManagerKeyword(event.target.value); setItemManagerPage(1); }} placeholder="例如：输入“红”查找红油、红烧类商品"/></label><span>找到 {visibleManagedItems.length} 个商品</span></div><div className="stock-table-wrap"><table className="stock-table"><thead><tr><th>商品</th><th>SKU</th><th>分类</th><th>采购/库存单位</th><th>预警天数</th><th>目标天数</th><th>平均成本</th><th>操作</th></tr></thead><tbody>{pagedManagedItems.rows.map((item) => <tr key={item.id}><td>{item.name}<small>{item.specification || "未填写规格"}</small></td><td>{item.sku}</td><td>{item.category}</td><td>{item.purchaseUom} / {item.stockUom}<small>1 {item.purchaseUom} = {qty(item.unitsPerPurchase)} {item.stockUom}</small></td><td>{qty(item.warningDays)} 天</td><td>{qty(item.targetDays)} 天<small>补货系数 ×{item.replenishmentFactor}</small></td><td>¥{unitPrice(averageCostByItem.get(item.id) ?? 0)}/{item.stockUom}</td><td><div className="record-actions"><button className="secondary" type="button" disabled={busy} onClick={() => beginEditItem(item)}><Pencil size={14}/>修改全部资料</button><button className="secondary danger-button" type="button" disabled={busy} onClick={() => removeItem(item)}>删除/停用</button></div></td></tr>)}{pagedManagedItems.rows.length === 0 && <tr><td colSpan={8} className="empty">没有找到相关商品</td></tr>}</tbody></table></div><Pagination page={pagedManagedItems.page} totalPages={pagedManagedItems.totalPages} totalRows={pagedManagedItems.totalRows} pageSize={pagedManagedItems.pageSize} onPageChange={setItemManagerPage} onPageSizeChange={(size) => { setItemManagerPageSize(size); setItemManagerPage(1); }}/></section>}
      {page === "excel" && <>
        <div className="inventory-title"><div><h1>Excel 台账导入</h1><p>适配“名称、规格、单位、月汇总、日期”结构的进销存台账；上传后先预览，再确认写入。</p></div></div>
        <section className="inventory-card word-import-card"><h3>本次模板的安全导入规则</h3><p>商品按 SKU 自动复用或创建，保留分类、规格和单位。可识别采购数量与单价的工作表会写入采购入库，导入日期以预览识别出的业务日期为准。</p><p>含“结余”的工作表可选择初始化库存，但仅适用于没有库存流水、也没有同批采购的商品。已有账本的结余请通过盘点核对，不能直接叠加。</p><input ref={excelFileRef} type="file" accept=".xlsx" onChange={previewExcel} disabled={busy}/><small>原始 Excel 不会被修改；同一文件成功后的重复导入不会重复入账。</small></section>
        {excelPreview && <section className="inventory-card word-preview"><h3>导入预览：{excelPreview.fileName}</h3><div className="preview-counts"><span>工作表 {excelPreview.sheets.length} 张</span><span>商品 {excelPreview.products.length} 条</span><span>采购入库 {excelPreview.purchases?.length ?? 0} 条</span><span>可识别初始结余 {excelPreview.closingStock.length} 条</span><span>业务日期 {excelPreview.closingDate}</span><span className={excelPreview.errors.length ? "error" : "ok"}>错误 {excelPreview.errors.length} 条</span></div><div className="table-wrap"><table><thead><tr><th>工作表</th><th>商品数</th><th>结余 / 采购</th><th>处理方式</th></tr></thead><tbody>{excelPreview.sheets.map((sheet: any) => <tr key={sheet.name}><td>{sheet.name}</td><td>{sheet.productCount}</td><td>{sheet.closingCount} / {sheet.purchaseCount ?? 0}</td><td>{sheet.mode === "ledger" ? "建档 + 可初始化结余" : sheet.purchaseCount > 0 ? "建档 + 采购入库" : "仅建档，无采购记录"}</td></tr>)}</tbody></table></div>{excelPreview.warnings.length > 0 && <ul className="import-errors">{excelPreview.warnings.map((warning: string, index: number) => <li key={index}>{warning}</li>)}</ul>}{excelPreview.errors.length > 0 ? <ul className="import-errors">{excelPreview.errors.map((error: string, index: number) => <li key={index}>{error}</li>)}</ul> : <><label className="import-check"><input type="checkbox" checked={includeClosingStock} onChange={(event) => setIncludeClosingStock(event.target.checked)}/>同时写入无流水商品的 {excelPreview.closingDate} 初始结余</label><button className="primary" disabled={busy || (!excelPreview.products.length && !excelPreview.purchases?.length && !excelPreview.closingStock.length)} onClick={commitExcel}>{busy ? "正在导入…" : "确认导入此 Excel"}</button></>}</section>}
      </>}
      {page === "word" && <>
        <div className="inventory-title"><div><h1>Word 表格导入</h1><p>上传 .docx 后先预览；确认无误才会创建商品和写入库存。</p></div></div>
        <section className="inventory-card word-import-card"><h3>支持的两类表格</h3><p>商品建档表：SKU、商品名称、分类、采购单位、库存单位、每采购单位数量、净含量、采购价、安全库存。</p><p>进出库表：业务日期、业务类型、SKU 或商品名称、数量、录入单位、采购单价、备注。</p><input ref={wordFileRef} type="file" accept=".docx" onChange={previewWord} disabled={busy}/><small>一个 Word 文档可放两张表；仅支持可编辑的 Word 普通表格，不支持图片或扫描件。</small></section>
        {wordPreview && <section className="inventory-card word-preview"><h3>导入预览：{wordPreview.fileName}</h3><div className="preview-counts"><span>识别表格 {wordPreview.tables} 张</span><span>商品 {wordPreview.products.length} 条</span><span>进出库 {wordPreview.stockEvents.length} 条</span><span className={wordPreview.errors.length ? "error" : "ok"}>错误 {wordPreview.errors.length} 条</span></div>{wordPreview.errors.length > 0 ? <ul className="import-errors">{wordPreview.errors.map((error: string, index: number) => <li key={index}>{error}</li>)}</ul> : <button className="primary" disabled={busy || (!wordPreview.products.length && !wordPreview.stockEvents.length)} onClick={commitWord}>{busy ? "正在导入…" : "确认导入库存"}</button>}</section>}
      </>}
    </main>
    {itemDeleteTarget && <div className="inventory-modal-backdrop" onClick={() => !busy && setItemDeleteTarget(null)}><section className="inventory-modal action-dialog" role="dialog" aria-modal="true" aria-labelledby="item-delete-title" onClick={(event) => event.stopPropagation()}><header><div><small>已建商品管理</small><h2 id="item-delete-title">确认删除或停用商品？</h2></div><button type="button" aria-label="关闭商品删除确认" disabled={busy} onClick={() => setItemDeleteTarget(null)}><X size={18}/></button></header><p>商品“{itemDeleteTarget.name}”将由系统安全处理：</p><ul><li>没有库存流水：直接删除。</li><li>已有流水但库存为 0：安全停用，历史账保留。</li><li>当前还有库存：不会删除，并会说明下一步如何清理库存。</li></ul><footer><button type="button" className="cancel-modal" disabled={busy} onClick={() => setItemDeleteTarget(null)}>取消</button><button type="button" className="danger-button" disabled={busy} onClick={() => confirmRemoveItem(itemDeleteTarget)}>{busy ? "正在处理…" : "确认删除/停用"}</button></footer></section></div>}
    {actionDialog && <div className="inventory-modal-backdrop" onClick={() => setActionDialog(null)}><section className={`inventory-modal action-dialog ${actionDialog.tone}`} role="alertdialog" aria-modal="true" aria-labelledby="action-dialog-title" onClick={(event) => event.stopPropagation()}><header><div><small>{actionDialog.tone === "success" ? "操作完成" : "操作提示"}</small><h2 id="action-dialog-title">{actionDialog.title}</h2></div><button type="button" aria-label="关闭操作提示" onClick={() => setActionDialog(null)}><X size={18}/></button></header><p>{actionDialog.detail}</p><footer><button type="button" className="primary" onClick={() => setActionDialog(null)}>我知道了</button></footer></section></div>}
    {stockDeleteTarget && <div className="inventory-modal-backdrop" onClick={() => !busy && setStockDeleteTarget(null)}><section className="inventory-modal action-dialog" role="dialog" aria-modal="true" aria-labelledby="stock-delete-title" onClick={(event) => event.stopPropagation()}><header><div><small>库存作业</small><h2 id="stock-delete-title">确认删除库存记录？</h2></div><button type="button" aria-label="关闭库存删除确认" disabled={busy} onClick={() => setStockDeleteTarget(null)}><X size={18}/></button></header><p>将删除“{stockDeleteTarget.itemName}”在 {stockDeleteTarget.businessDate} 的这条库存记录。</p><ul><li>删除后当前库存与平均成本会自动重新计算。</li><li>删除成功后可立即继续录入、修改或建档。</li></ul><footer><button type="button" className="cancel-modal" disabled={busy} onClick={() => setStockDeleteTarget(null)}>取消</button><button type="button" className="danger-button" disabled={busy} onClick={() => confirmDeleteStockRecord(stockDeleteTarget)}>{busy ? "正在删除…" : "确认删除记录"}</button></footer></section></div>}
    {cleanupTarget && <div className="inventory-modal-backdrop" onClick={() => !busy && setCleanupTarget(null)}><section className="inventory-modal cleanup-choice" role="dialog" aria-modal="true" aria-labelledby="cleanup-choice-title" onClick={(event) => event.stopPropagation()}><header><div><small>库存清理</small><h2 id="cleanup-choice-title">清理后是否继续显示“{cleanupTarget.itemName}”？</h2></div><button type="button" aria-label="关闭库存清理对话框" disabled={busy} onClick={() => setCleanupTarget(null)}><X size={18}/></button></header><p>当前将清理 {qty(cleanupTarget.quantity)} {cleanupTarget.uom}，并生成可追溯的报损记录。请选择清理后的商品状态：</p><div className="cleanup-choice-grid"><button type="button" className="keep-visible-choice" disabled={busy} onClick={() => chooseCleanup(cleanupTarget, true)}><b>清理后继续显示</b><span>库存归零，但商品仍可再次入库；有历史用量时仍可能产生预警。</span></button><button type="button" className="hide-item-choice" disabled={busy} onClick={() => chooseCleanup(cleanupTarget, false)}><b>清理并隐藏商品</b><span>保留历史账，但不再出现在商品库存、预警和库存作业选择中。</span></button></div><button type="button" className="cancel-modal" disabled={busy} onClick={() => setCleanupTarget(null)}>取消，不清理</button></section></div>}
    {cleanupConfirmTarget && <div className="inventory-modal-backdrop" onClick={() => !busy && setCleanupConfirmTarget(null)}><section className="inventory-modal action-dialog" role="dialog" aria-modal="true" aria-labelledby="cleanup-confirm-title" onClick={(event) => event.stopPropagation()}><header><div><small>库存清理</small><h2 id="cleanup-confirm-title">确认清理库存？</h2></div><button type="button" aria-label="关闭清理确认" disabled={busy} onClick={() => setCleanupConfirmTarget(null)}><X size={18}/></button></header><p>确认将“{cleanupConfirmTarget.row.itemName}”的 {qty(cleanupConfirmTarget.row.quantity)} {cleanupConfirmTarget.row.uom} 清理为零？</p><ul><li>系统会生成可追溯的报损记录。</li><li>{cleanupConfirmTarget.keepVisible ? "清理后商品继续显示，之后仍可再次入库。" : "清理后商品将隐藏并停止库存预警，历史账仍保留。"}</li></ul><footer><button type="button" className="cancel-modal" disabled={busy} onClick={() => setCleanupConfirmTarget(null)}>返回</button><button type="button" className="danger-button" disabled={busy} onClick={() => clearCurrentStock(cleanupConfirmTarget.row, cleanupConfirmTarget.keepVisible)}>{busy ? "正在清理…" : "确认清理库存"}</button></footer></section></div>}
    {quickReceiveTarget && <div className="inventory-modal-backdrop" onClick={() => !busy && setQuickReceiveTarget(null)}><section className="inventory-modal quick-receive-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-receive-title" onClick={(event) => event.stopPropagation()}><header><div><small>库存总览 · 快捷入库</small><h2 id="quick-receive-title">录入“{quickReceiveTarget.itemName}”今日收货</h2></div><button type="button" aria-label="关闭快捷入库" disabled={busy} onClick={() => setQuickReceiveTarget(null)}><X size={18}/></button></header><form onSubmit={submitQuickReceive}><p>已默认选择：{quickReceiveTarget.warehouseName} · {quickReceiveTarget.uom}。通常只需填写数量。</p><div className="quick-receive-grid"><label>日期<input type="date" disabled={busy} value={quickReceiveDate} onChange={(event) => setQuickReceiveDate(event.target.value)} required/></label><label>收货数量（{quickReceiveTarget.uom}）<input type="number" disabled={busy} autoFocus min="0.01" step="0.01" value={quickReceiveQuantity} onChange={(event) => setQuickReceiveQuantity(event.target.value)} placeholder="例如：10" required/></label><label>采购单价（¥/{quickReceiveTarget.uom}）<input type="number" disabled={busy} min="0" step="any" value={quickReceivePrice} onChange={(event) => setQuickReceivePrice(event.target.value)} placeholder="首次入库请填写单价"/><small>默认当前平均成本；若本次进价不同可直接改，单价保留小数，整笔金额才取到分。</small></label></div><footer><button type="button" className="cancel-modal" disabled={busy} onClick={() => setQuickReceiveTarget(null)}>取消</button><button className="primary" disabled={busy}>{busy ? "正在入库…" : "确认入库"}</button></footer></form></section></div>}
    {itemEditDraft && <div className="inventory-modal-backdrop" onClick={() => !busy && closeItemEditor()}><section className="inventory-modal item-editor" role="dialog" aria-modal="true" aria-labelledby="item-editor-title" onClick={(event) => event.stopPropagation()}><header><div><small>已建商品管理</small><h2 id="item-editor-title">修改“{itemEditDraft.name}”全部资料</h2></div><button type="button" aria-label="关闭商品修改对话框" disabled={busy} onClick={closeItemEditor}><X size={18}/></button></header><div className="item-editor-grid"><label>商品名称<input aria-label="修改商品名称" value={itemEditDraft.name} onChange={(event) => setItemEditDraft({ ...itemEditDraft, name: event.target.value })}/></label><label>商品 SKU<input aria-label="修改商品 SKU" value={itemEditDraft.sku} onChange={(event) => setItemEditDraft({ ...itemEditDraft, sku: event.target.value.toUpperCase() })}/></label><label>规格<input aria-label="修改规格" value={itemEditDraft.specification} onChange={(event) => setItemEditDraft({ ...itemEditDraft, specification: event.target.value })}/><button type="button" className="secondary spec-parse-button" onClick={applySpecificationToItemDraft}>按规格自动填充</button></label><label>分类<select aria-label="修改商品分类" value={itemEditDraft.category} onChange={(event) => setItemEditDraft({ ...itemEditDraft, category: event.target.value })}>{Array.from(new Set([...categoryOptions, itemEditDraft.category])).map((category) => <option value={category} key={category}>{category}</option>)}</select></label><label>采购单位<input aria-label="修改采购单位" value={itemEditDraft.purchaseUom} onChange={(event) => setItemEditDraft({ ...itemEditDraft, purchaseUom: event.target.value })}/></label><label>最小库存单位<input aria-label="修改最小库存单位" value={itemEditDraft.stockUom} onChange={(event) => setItemEditDraft({ ...itemEditDraft, stockUom: event.target.value })}/></label><label>1 个采购单位含多少最小单位<EditableNumber ariaLabel="修改采购换算数量" value={itemEditDraft.unitsPerPurchase} onChange={(value) => setItemEditDraft({ ...itemEditDraft, unitsPerPurchase: value })} min={0.01} step={0.01}/></label><label>每最小单位净含量<EditableNumber ariaLabel="修改净含量" value={itemEditDraft.unitNetContent} onChange={(value) => setItemEditDraft({ ...itemEditDraft, unitNetContent: value })} min={0.01} step={0.01}/></label><label>净含量单位<input aria-label="修改净含量单位" value={itemEditDraft.contentUom} onChange={(event) => setItemEditDraft({ ...itemEditDraft, contentUom: event.target.value })}/></label><label>预警天数<EditableNumber ariaLabel="修改预警天数" value={itemEditDraft.warningDays} onChange={(value) => setItemEditDraft({ ...itemEditDraft, warningDays: value })} min={0} step={0.1}/></label><label>目标库存天数<EditableNumber ariaLabel="修改目标库存天数" value={itemEditDraft.targetDays} onChange={(value) => setItemEditDraft({ ...itemEditDraft, targetDays: value })} min={0.1} step={0.1}/></label><label>补货系数<EditableNumber ariaLabel="修改补货系数" value={itemEditDraft.replenishmentFactor} onChange={(value) => setItemEditDraft({ ...itemEditDraft, replenishmentFactor: value })} min={0.1} step={0.1}/></label></div><div className="item-editor-note">“规格”保留原包装文字；点击“按规格自动填充”会把例如“5kg/4袋”拆为 1 件 = 4 袋、每袋 5 kg。修改单位后，已有库存数量不会自动换算；请确认新旧单位代表同一实际数量。</div><footer><button type="button" className="cancel-modal" disabled={busy} onClick={closeItemEditor}>取消</button><button type="button" className="primary" disabled={busy} onClick={saveItemSettings}>{busy ? "正在保存…" : "保存全部修改"}</button></footer></section></div>}
  </div>;
}

function Metric({ label, value, note, alert = false }: { label: string; value: string; note: string; alert?: boolean }) { return <article className={alert ? "inventory-metric alert" : "inventory-metric"}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function StockTable({ rows, busy, onQuickReceive, onInlineQuickStock }: { rows: DashboardData["stock"]; busy: boolean; onQuickReceive: (row: DashboardData["stock"][number]) => void; onInlineQuickStock: (row: DashboardData["stock"][number], quantity: number, eventType: "purchase" | "issue" | "sale" | "waste") => Promise<boolean> }) {
  const [editingKey, setEditingKey] = useState("");
  const [quantity, setQuantity] = useState("");
  const [eventType, setEventType] = useState<"purchase" | "issue" | "sale" | "waste">("purchase");
  function start(row: DashboardData["stock"][number]) {
    if (row.averageCostCents <= 0) { onQuickReceive(row); return; }
    setEditingKey(`${row.item_id}-${row.warehouse_id}`); setQuantity(""); setEventType("purchase");
  }
  async function submit(event: FormEvent<HTMLFormElement>, row: DashboardData["stock"][number]) {
    event.preventDefault();
    const parsed = Number(quantity);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    const succeeded = await onInlineQuickStock(row, parsed, eventType);
    if (succeeded) { setEditingKey(""); setQuantity(""); }
  }
  return <div className="stock-table-wrap"><table className="stock-table"><thead><tr><th>商品</th><th>分类</th><th>现存数量 / 直接操作</th><th>平均成本</th><th>日均用量</th><th>动态预警线</th><th>目标库存</th><th>建议采购</th><th>状态</th></tr></thead><tbody>{rows.length ? rows.map((row) => {
    const key = `${row.item_id}-${row.warehouse_id}`;
    return <tr className={row.isWarning ? "warning-row" : ""} key={key}><td><b>{row.itemName}</b><small>{row.sku} · {row.warehouseName}</small></td><td>{row.category}<small>预警 {qty(row.warningDays)} 天 · 目标 {qty(row.targetDays)} 天 · ×{row.replenishmentFactor}</small></td><td>{editingKey === key ? <form className="inline-quick-receive" onSubmit={(event) => void submit(event, row)}><select disabled={busy} aria-label={`${row.itemName} 直接操作类型`} value={eventType} onChange={(event) => setEventType(event.target.value as typeof eventType)}><option value="purchase">入库</option><option value="issue">领料出库</option><option value="sale">销售出库</option><option value="waste">报损出库</option></select><input disabled={busy} aria-label={`${row.itemName} 今日操作数量`} type="number" inputMode="decimal" min="0.01" step="0.01" autoFocus value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder={`${eventType === "purchase" ? "入库" : "出库"} ${row.uom}`}/><button type="submit" className="primary" disabled={busy}>{eventType === "purchase" ? "入库" : "出库"}</button><button type="button" className="secondary" disabled={busy} onClick={() => { setEditingKey(""); setQuantity(""); }}>取消</button></form> : <button type="button" className="stock-quantity-link" onClick={() => start(row)} title="点击直接录入今日入库或出库">{qty(row.quantity)} {row.uom}</button>}</td><td>¥{unitPrice(row.averageCostCents)}/{row.uom}</td><td>{row.historyMode === "no_data" ? <span className="data-missing">数据不足</span> : <>{qty(row.averageDailyUsage)} {row.uom}/天<small>{row.historyDays} 天数据</small></>}</td><td>{qty(row.warningQuantity)} {row.uom}</td><td>{qty(row.targetQuantity)} {row.uom}</td><td><b className={row.suggestedPurchaseQuantity > 0 ? "purchase-suggestion" : ""}>{qty(row.suggestedPurchaseQuantity)} {row.uom}</b>{row.unitsPerPurchase > 1 && row.suggestedPurchaseQuantity > 0 && <small>约 {qty(row.suggestedPurchaseQuantity / row.unitsPerPurchase)} {row.purchaseUom}</small>}</td><td>{row.isWarning ? <span className="status warn">预警</span> : row.historyMode === "no_data" ? <span className="status neutral">待积累数据</span> : <span className="status ok">正常</span>}</td></tr>;
  }) : <tr><td colSpan={9} className="empty">暂无符合条件的库存记录</td></tr>}</tbody></table></div>;
}

function EditableNumber({ ariaLabel, value, onChange, min, step }: { ariaLabel: string; value: string; onChange: (value: string) => void; min: number; step: number }) {
  function adjust(direction: 1 | -1) {
    const current = Number(value);
    const base = Number.isFinite(current) ? current : min;
    const precision = Math.max(0, String(step).split(".")[1]?.length ?? 0);
    const next = Math.max(min, Number((base + direction * step).toFixed(precision)));
    onChange(String(next));
  }
  return <div className="editable-number">
    <input aria-label={ariaLabel} type="text" inputMode="decimal" value={value} onFocus={(event) => event.currentTarget.select()} onChange={(event) => onChange(event.target.value)} />
    <span className="editable-number-buttons" aria-hidden="true"><button type="button" tabIndex={-1} onClick={() => adjust(1)}>▲</button><button type="button" tabIndex={-1} onClick={() => adjust(-1)}>▼</button></span>
  </div>;
}

function Pagination({ page, totalPages, totalRows, pageSize, onPageChange, onPageSizeChange }: { page: number; totalPages: number; totalRows: number; pageSize: number; onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void }) {
  return <div className="inventory-pagination"><span>共 {totalRows} 条</span><label>每页<select aria-label="每页显示数量" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}><option value="10">10 条</option><option value="20">20 条</option><option value="50">50 条</option></select></label><button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>上一页</button><b>{page} / {totalPages}</b><button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>下一页</button></div>;
}

function eventName(eventType: string) {
  return Object.fromEntries(eventOptions)[eventType] ?? eventType;
}
