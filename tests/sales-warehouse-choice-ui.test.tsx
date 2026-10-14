// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReconciliationDesk } from "@/components/reconciliation-desk";
afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.unstubAllGlobals(); });

it("旧销量批次缺仓库时必须人工选原仓库，再按同一上下文确认配方", async () => {
  const data = { pendingSales: [{ id: "sale-old", warehouseId: null, salesSku: "", dishName: "嫩牛肉", quantity: 1, businessDate: "2026-10-01", matchStatus: "pending", fileName: "旧销量.xlsx", candidates: [{ recipeId: "recipe", recipeName: "鸡蛋嫩牛肉", score: 80, method: "similar" }] }], recipeIssues: [], incompleteItems: [], counts: [], variance: [] };
  const patches: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === "PATCH") { patches.push(JSON.parse(String(options.body))); return new Response(JSON.stringify({ message: "匹配成功" }), { status: 200 }); }
    return new Response(JSON.stringify(data), { status: 200 });
  }));
  render(<ReconciliationDesk items={[]} warehouses={[{ id: "w", name: "总仓" }, { id: "w2", name: "第二仓" }]}/>);
  const recipeInput = await screen.findByRole("combobox", { name: "为嫩牛肉选择配方" });
  fireEvent.focus(recipeInput); fireEvent.mouseDown(screen.getByRole("option", { name: /鸡蛋嫩牛肉/ }));
  expect((screen.getByRole("button", { name: "确认匹配" }) as HTMLButtonElement).disabled).toBe(true);
  const warehouseInput = screen.getByRole("combobox", { name: "为嫩牛肉选择原仓库" });
  fireEvent.focus(warehouseInput); fireEvent.mouseDown(screen.getByRole("option", { name: "第二仓" }));
  fireEvent.click(screen.getByRole("button", { name: "确认匹配" }));
  await waitFor(() => expect(patches).toHaveLength(1));
  expect(patches[0]).toEqual({ lineId: "sale-old", recipeId: "recipe", warehouseId: "w2" });
});
