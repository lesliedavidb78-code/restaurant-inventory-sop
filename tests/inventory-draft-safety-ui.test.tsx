// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InventoryDesk } from "@/components/inventory-desk";

const item = { id: "beef", name: "牛肉", sku: "BEEF", category: "肉类", stockUom: "袋", purchaseUom: "箱", unitsPerPurchase: 10, unitNetContent: 1, contentUom: "kg", specification: "1kg×10袋/箱", warningDays: 15, targetDays: 30, replenishmentFactor: 1.2 };
const row = { item_id: "beef", warehouse_id: "w", itemName: "牛肉", warehouseName: "测试仓", sku: "BEEF", category: "肉类", quantity: 5, averageCostCents: 3500, uom: "袋", warningDays: 15, targetDays: 30, replenishmentFactor: 1.2, historyMode: "no_data", warningQuantity: 0, targetQuantity: 0, suggestedPurchaseQuantity: 0, unitsPerPurchase: 10, purchaseUom: "箱" };
const data = { period: "2026-10", stock: [row], stockRecords: [], categorySettings: [], warehouses: [{ id: "w", name: "测试仓" }, { id: "w2", name: "第二仓" }], items: [item] };
afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.unstubAllGlobals(); });
function setup(fetchMock: (url: string, options?: RequestInit) => Promise<Response> = vi.fn(async () => new Response(JSON.stringify(data), { status: 200 }))) { vi.stubGlobal("fetch", fetchMock); return render(<InventoryDesk initialData={data as any}/>); }
function chooseItem() { fireEvent.change(screen.getByLabelText("商品（输入名称、分类或 SKU 搜索）"), { target: { value: "牛肉" } }); fireEvent.click(screen.getByRole("option", { name: /牛肉/ })); }

describe("库存录入草稿保护", () => {
  it("总览成本列始终存在，零成本和每克微量成本均准确显示", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })));
    const view = render(<InventoryDesk initialData={{ ...data, stock: [{ ...row, averageCostCents: 0 }] } as any}/>);
    expect(screen.getByRole("columnheader", { name: "平均成本" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "¥0.00/袋" })).toBeTruthy();
    view.unmount();
    render(<InventoryDesk initialData={{ ...data, stock: [{ ...row, averageCostCents: 3.5, uom: "g" }] } as any}/>);
    expect(screen.getByRole("cell", { name: "¥0.035/g" })).toBeTruthy();
  });
  it("切页与组件重挂载恢复同一整张单据，不把箱静默改成袋或日期改成今天", async () => {
    const view = setup(); fireEvent.click(screen.getByRole("button", { name: "库存作业" })); chooseItem();
    fireEvent.change(screen.getByLabelText("业务类型"), { target: { value: "transfer_in" } });
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("录入单位"), { target: { value: "purchase" } });
    fireEvent.change(screen.getByLabelText("业务日期"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("仓库"), { target: { value: "w2" } });
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "测试送货单" } });
    fireEvent.click(screen.getByRole("button", { name: "商品建档" })); fireEvent.click(screen.getByRole("button", { name: "库存作业" }));
    expect((screen.getByLabelText("录入单位") as HTMLSelectElement).value).toBe("purchase");
    expect((screen.getByLabelText("业务日期") as HTMLInputElement).value).toBe("2026-01-01");
    expect((screen.getByLabelText("仓库") as HTMLSelectElement).value).toBe("w2");
    expect((screen.getByLabelText("备注") as HTMLInputElement).value).toBe("测试送货单");
    view.unmount(); setup(); fireEvent.click(screen.getByRole("button", { name: "库存作业" }));
    await waitFor(() => expect((screen.getByLabelText("数量") as HTMLInputElement).value).toBe("10"));
    expect((screen.getByLabelText("业务类型") as HTMLSelectElement).value).toBe("transfer_in");
    expect((screen.getByLabelText("录入单位") as HTMLSelectElement).value).toBe("purchase");
    expect((screen.getByLabelText("业务日期") as HTMLInputElement).value).toBe("2026-01-01");
    expect((screen.getByLabelText("仓库") as HTMLSelectElement).value).toBe("w2");
    expect((screen.getByLabelText("备注") as HTMLInputElement).value).toBe("测试送货单");
    expect((screen.getByLabelText("商品（输入名称、分类或 SKU 搜索）") as HTMLInputElement).value).toContain("牛肉");
  });

  it("总览行内出库失败保留操作类型、数量与编辑框，允许修正后重试", async () => {
    setup(vi.fn(async (_url: string, options?: RequestInit) => new Response(JSON.stringify(options?.method === "POST" ? { error: "库存不足，不能出库" } : data), { status: options?.method === "POST" ? 400 : 200 })));
    fireEvent.click(screen.getByRole("button", { name: "5 袋" }));
    fireEvent.change(screen.getByLabelText("牛肉 直接操作类型"), { target: { value: "sale" } });
    fireEvent.change(screen.getByLabelText("牛肉 今日操作数量"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "出库" }));
    await screen.findByText("库存不足，不能出库");
    expect((screen.getByLabelText("牛肉 今日操作数量") as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText("牛肉 直接操作类型") as HTMLSelectElement).value).toBe("sale");
    expect((screen.getByRole("button", { name: "出库" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("普通库存请求失败保留草稿与幂等键，修改数量后生成新键", async () => {
    const requests: any[] = [];
    setup(vi.fn(async (url: string, options?: RequestInit) => {
      if (url === "/api/stock") { requests.push(JSON.parse(String(options?.body))); return new Response(JSON.stringify({ error: "连接中断，请重试" }), { status: 503 }); }
      return new Response(JSON.stringify(data), { status: 200 });
    }));
    fireEvent.click(screen.getByRole("button", { name: "库存作业" })); chooseItem();
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/采购单价（人民币/), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "确认记入库存" }));
    await screen.findByText("连接中断，请重试");
    expect((screen.getByLabelText("数量") as HTMLInputElement).value).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "确认记入库存" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0].requestId).toEqual(expect.any(String));
    expect(requests[0].requestId.length).toBeGreaterThan(10);
    expect(requests[1].requestId).toBe(requests[0].requestId);
    await screen.findByText("连接中断，请重试");
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "确认记入库存" }));
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2].requestId).not.toBe(requests[1].requestId);
    expect(requests[2].quantity).toBe(2);
  });

  it("采购单位标签随草稿单位切换，微量单价不提前四舍五入到整数分", async () => {
    const requests: any[] = [];
    setup(vi.fn(async (url: string, options?: RequestInit) => {
      if (url === "/api/stock") { requests.push(JSON.parse(String(options?.body))); return new Response(JSON.stringify({ error: "测试中止，保留草稿" }), { status: 400 }); }
      return new Response(JSON.stringify(data), { status: 200 });
    }));
    fireEvent.click(screen.getByRole("button", { name: "库存作业" })); chooseItem();
    fireEvent.change(screen.getByLabelText("录入单位"), { target: { value: "purchase" } });
    expect(screen.getByLabelText(/采购单价（人民币 ¥\/箱）/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/采购单价（人民币/), { target: { value: "0.035" } });
    // 暂无成本的入库商品不需要异常单价确认。
    const confirmation = screen.queryByRole("checkbox"); if (confirmation) fireEvent.click(confirmation);
    fireEvent.click(screen.getByRole("button", { name: "确认记入库存" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].unitCostCents).toBeCloseTo(3.5, 10);
  });

  it("Excel 采购导入反馈显示实际业务日期、已有商品采购和结余核对原因", async () => {
    const preview = { fileName: "10月进货.xlsx", closingDate: "2026-10-13", fileHash: "test-hash", sheets: [{ name: "采购", productCount: 1, closingCount: 1, purchaseCount: 1, mode: "purchase_only" }], products: [item], purchases: [{ sku: "BEEF" }], closingStock: [{ sku: "BEEF" }], warnings: [], errors: [] };
    const warning = "BEEF 已有库存流水，结余需通过盘点核对。";
    setup(vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/preview") ? preview : url.endsWith("/commit") ? { productCount: 0, skipped: 1, purchaseCount: 1, closingCount: 0, warnings: [warning] } : data), { status: 200 })));
    fireEvent.click(screen.getByRole("button", { name: "Excel 台账导入" }));
    const fileInput = document.querySelector('input[type="file"]')!;
    fireEvent.change(fileInput, { target: { files: [new File(["测试"], "10月进货.xlsx")] } });
    await screen.findByText("导入预览：10月进货.xlsx");
    expect(screen.getByText("建档 + 采购入库")).toBeTruthy();
    expect(screen.getByText(/2026-10-13 初始结余/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认导入此 Excel" }));
    await screen.findByRole("alertdialog");
    expect(screen.getByRole("alertdialog").textContent).toContain("写入 1 条采购入库");
    expect(screen.getByRole("alertdialog").textContent).toContain("复用 1 个已有商品");
    expect(screen.getByRole("alertdialog").textContent).toContain(warning);
  });
});
