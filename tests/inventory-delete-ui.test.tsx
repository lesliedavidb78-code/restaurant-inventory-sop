// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InventoryDesk } from "@/components/inventory-desk";

const item = {
  id: "item-delete-repro", sku: "CS-NR-001", name: "删除回归牛肉", specification: "散装", category: "测试分类",
  purchaseUom: "斤", stockUom: "斤", unitsPerPurchase: 1, unitNetContent: 500, contentUom: "g",
  purchasePriceCents: 0, minimumQty: 0, warningDays: 15, targetDays: 30, replenishmentFactor: 1.2,
};

const record = {
  id: "record-delete-repro", itemId: item.id, warehouseId: "warehouse-delete-repro", eventType: "purchase", businessDate: "2026-08-20",
  inputQuantity: 10, inputUom: "斤", displayUom: "斤", inputUnitCostCents: 3500, quantityChange: 10, unitCostCents: 3500,
  note: "删除后仍可编辑回归", sourceType: "manual", createdAt: "2026-08-20T10:00:00.000Z", itemName: item.name, sku: item.sku,
  purchaseUom: "斤", stockUom: "斤", warehouseName: "测试总仓",
};

function dashboard(stockRecords = [record]) {
  return {
    period: "2026-06", sales: null, gross: [], productMargins: [], expenses: [], totalCogs: 0, totalExpense: 0, profit: 0,
    trends: [], bank: [], parties: [], close: null, imports: [], categorySettings: [], warehouses: [{ id: "warehouse-delete-repro", name: "测试总仓" }],
    items: [item], stock: [{ item_id: item.id, warehouse_id: "warehouse-delete-repro", itemName: item.name, sku: item.sku, category: item.category,
      purchaseUom: "斤", unitsPerPurchase: 1, unitNetContent: 500, contentUom: "g", uom: "斤", minimumQty: 0, warningDays: 15,
      targetDays: 30, replenishmentFactor: 1.2, warehouseName: "测试总仓", quantity: 10, value_cents: 35000, averageCostCents: 3500,
      isWarning: false, averageDailyUsage: 0, warningQuantity: 0, targetQuantity: 0, suggestedPurchaseQuantity: 0, historyMode: "no_data", historyDays: 0, hasStockEvents: true,
    }], stockRecords,
  } as any;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("删除库存记录后页面仍可编辑", () => {
  it("总览刷新较慢时，删除成功后也必须立刻允许打开编辑器", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    let finishDashboardRefresh: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (url === "/api/stock-records" && options?.method === "DELETE") return Promise.resolve(new Response(JSON.stringify({ message: "库存记录已删除" }), { status: 200 }));
      if (url === "/api/ui-diagnostics") return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      if (url === "/api/dashboard?period=2026-06") return new Promise<Response>((resolve) => { finishDashboardRefresh = resolve; });
      throw new Error(`未预期请求：${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<InventoryDesk initialData={dashboard()}/>);
    fireEvent.click(screen.getByRole("button", { name: "库存作业" }));
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认删除记录" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/dashboard?period=2026-06", expect.any(Object)));

    fireEvent.click(screen.getByRole("button", { name: "商品建档" }));
    const edit = await screen.findByRole("button", { name: "修改全部资料" });
    expect((edit as HTMLButtonElement).disabled).toBe(false);

    finishDashboardRefresh?.(new Response(JSON.stringify(dashboard([])), { status: 200 }));
  });

  it("删除后立即仍能打开商品完整修改，并可继续选择商品录入", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === "/api/stock-records" && options?.method === "DELETE") return new Response(JSON.stringify({ message: "库存记录已删除" }), { status: 200 });
      if (url === "/api/dashboard?period=2026-06") return new Response(JSON.stringify(dashboard([])), { status: 200 });
      throw new Error(`未预期请求：${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<InventoryDesk initialData={dashboard()}/>);
    fireEvent.click(screen.getByRole("button", { name: "库存作业" }));
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认删除记录" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/dashboard?period=2026-06", expect.any(Object)));

    fireEvent.click(screen.getByRole("button", { name: "商品建档" }));
    const edit = await screen.findByRole("button", { name: "修改全部资料" });
    expect((edit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(edit);
    expect(await screen.findByRole("heading", { name: `修改“${item.name}”全部资料` })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "关闭商品修改对话框" }));
    fireEvent.click(screen.getByRole("button", { name: "库存作业" }));
    const search = await screen.findByPlaceholderText("例如：输入“辣椒”“牛肉”后直接选择");
    fireEvent.change(search, { target: { value: "牛肉" } });
    expect(await screen.findByRole("option", { name: new RegExp(`${item.name}.*${item.sku}`) })).toBeTruthy();
  });

  it("商品删除后即使总览仍在刷新，也立即可继续建档并显示弹窗结果", async () => {
    let finishDashboardRefresh: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (url === "/api/master-data" && options?.method === "DELETE") return Promise.resolve(new Response(JSON.stringify({ mode: "deleted", message: "商品已删除，历史无库存流水。" }), { status: 200 }));
      if (url === "/api/dashboard?period=2026-06") return new Promise<Response>((resolve) => { finishDashboardRefresh = resolve; });
      throw new Error(`未预期请求：${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<InventoryDesk initialData={dashboard([])}/>);
    fireEvent.click(screen.getByRole("button", { name: "商品建档" }));
    fireEvent.click(await screen.findByRole("button", { name: "删除/停用" }));
    expect(await screen.findByRole("heading", { name: "确认删除或停用商品？" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认删除/停用" }));
    expect(await screen.findByRole("heading", { name: "商品已删除" })).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/dashboard?period=2026-06", expect.any(Object)));

    const nameInput = screen.getByPlaceholderText("例如：牛肉卷") as HTMLInputElement;
    expect(nameInput.disabled).toBe(false);
    fireEvent.change(nameInput, { target: { value: "删除后新建商品" } });
    expect(nameInput.value).toBe("删除后新建商品");

    finishDashboardRefresh?.(new Response(JSON.stringify(dashboard([])), { status: 200 }));
  });

  it("库存作业删除先显示居中确认，确认后立即可继续编辑且显示结果", async () => {
    let finishDashboardRefresh: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (url === "/api/stock-records" && options?.method === "DELETE") return Promise.resolve(new Response(JSON.stringify({ message: "库存记录已删除" }), { status: 200 }));
      if (url === "/api/ui-diagnostics") return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      if (url === "/api/dashboard?period=2026-06") return new Promise<Response>((resolve) => { finishDashboardRefresh = resolve; });
      throw new Error(`未预期请求：${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<InventoryDesk initialData={dashboard()}/>);
    fireEvent.click(screen.getByRole("button", { name: "库存作业" }));
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    expect(await screen.findByRole("heading", { name: "确认删除库存记录？" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认删除记录" }));
    expect(await screen.findByRole("heading", { name: "库存记录已删除" })).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/dashboard?period=2026-06", expect.any(Object)));

    const search = screen.getByPlaceholderText("例如：输入“辣椒”“牛肉”后直接选择") as HTMLInputElement;
    expect(search.disabled).toBe(false);
    fireEvent.change(search, { target: { value: "牛肉" } });
    expect(search.value).toBe("牛肉");
    finishDashboardRefresh?.(new Response(JSON.stringify(dashboard([])), { status: 200 }));
  });

  it("库存清理需要二次确认，完成后给出居中结果提示", async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === "/api/inventory-cleanup" && options?.method === "POST") return new Response(JSON.stringify({ message: "库存已清理" }), { status: 200 });
      if (url === "/api/dashboard?period=2026-06") return new Response(JSON.stringify(dashboard([])), { status: 200 });
      throw new Error(`未预期请求：${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<InventoryDesk initialData={dashboard()}/>);
    fireEvent.click(screen.getByRole("tab", { name: "库存清理" }));
    fireEvent.click(await screen.findByRole("button", { name: "清理库存" }));
    expect(await screen.findByRole("heading", { name: new RegExp(`清理后是否继续显示.*${item.name}`) })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /清理后继续显示/ }));
    expect(await screen.findByRole("heading", { name: "确认清理库存？" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认清理库存" }));
    expect(await screen.findByRole("heading", { name: "库存已清理" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/inventory-cleanup", expect.objectContaining({ method: "POST" }));
  });
});
