// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecipeManager } from "@/components/recipe-manager";
const items = [{ id: "beef", name: "牛肉", sku: "BEEF", category: "肉类", stockUom: "g", unitNetContent: 1, contentUom: "g", specification: "" }];
const savedDraft = { name: "已提交配方 A", salesSku: "A", portionQty: "1", portionUom: "份", sourceType: "manual", sourceName: "", note: "", active: true, lines: [{ itemId: "beef", sourceQuantity: "100", sourceUom: "g", yieldRate: "100", keyword: "牛肉" }] };
afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.unstubAllGlobals(); });

it("配方保存期间锁定输入/新建/编辑，失败后原草稿完整保留", async () => {
  window.sessionStorage.setItem("store-inventory-recipe-draft-v1", JSON.stringify(savedDraft));
  let finishPost!: (response: Response) => void;
  const deferred = new Promise<Response>((resolve) => { finishPost = resolve; });
  const calls: RequestInit[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === "POST") { calls.push(options); return deferred; }
    return new Response(JSON.stringify({ recipes: [] }), { status: 200 });
  }));
  render(<RecipeManager items={items}/>);
  const name = await screen.findByLabelText("菜品名称");
  await waitFor(() => expect((name as HTMLInputElement).value).toBe("已提交配方 A"));
  fireEvent.click(screen.getByRole("button", { name: "保存配方" }));
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(name.matches(":disabled")).toBe(true);
  expect((screen.getByRole("button", { name: "新建配方" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByLabelText("原料用量 1").matches(":disabled")).toBe(true);
  finishPost(new Response(JSON.stringify({ error: "保存失败，请核对" }), { status: 400 }));
  await screen.findByText("保存失败，请核对");
  expect(name.matches(":disabled")).toBe(false);
  expect((name as HTMLInputElement).value).toBe("已提交配方 A");
  expect(JSON.parse(window.sessionStorage.getItem("store-inventory-recipe-draft-v1")!).lines[0].sourceQuantity).toBe("100");
});

it("离开再返回后编辑了新草稿，旧保存成功响应不能清除新草稿", async () => {
  window.sessionStorage.setItem("store-inventory-recipe-draft-v1", JSON.stringify(savedDraft));
  let finishPost!: (response: Response) => void;
  const deferred = new Promise<Response>((resolve) => { finishPost = resolve; });
  let posts = 0;
  let gets = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === "POST") { posts++; return deferred; }
    gets++;
    return new Response(JSON.stringify({ recipes: [] }), { status: 200 });
  }));
  const view = render(<RecipeManager items={items}/>);
  await waitFor(() => expect((screen.getByLabelText("菜品名称") as HTMLInputElement).value).toBe("已提交配方 A"));
  fireEvent.click(screen.getByRole("button", { name: "保存配方" }));
  await waitFor(() => expect(posts).toBe(1));
  view.unmount(); render(<RecipeManager items={items}/>);
  await waitFor(() => expect((screen.getByLabelText("菜品名称") as HTMLInputElement).value).toBe("已提交配方 A"));
  fireEvent.change(screen.getByLabelText("菜品名称"), { target: { value: "返回后输入的新配方 B" } });
  finishPost(new Response(JSON.stringify({ message: "A 已保存", pendingLines: [] }), { status: 200 }));
  await waitFor(() => expect(gets).toBe(3));
  await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem("store-inventory-recipe-draft-v1")!).name).toBe("返回后输入的新配方 B"));
  expect((screen.getByLabelText("菜品名称") as HTMLInputElement).value).toBe("返回后输入的新配方 B");
});

it("配方分页覆盖完整列表，搜索同一个框可匹配原料分类", async () => {
  const recipes = Array.from({ length: 21 }, (_, index) => ({ id: `r${index}`, name: `测试菜品${String(index + 1).padStart(2, "0")}`, salesSku: `SKU-${index}`, portionQty: 1, portionUom: "份", sourceType: "manual", sourceName: "", note: "", active: true, lines: index === 20 ? [{ id: "line", itemId: "beef", itemName: "牛肉", sku: "BEEF", stockUom: "g", sourceQuantity: 100, sourceUom: "g", yieldRate: 100, stockQuantity: 100, conversionStatus: "ready", conversionNote: "" }] : [] }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ recipes }), { status: 200 })));
  render(<RecipeManager items={items}/>);
  await screen.findByRole("button", { name: "测试菜品01" });
  expect(screen.queryByRole("button", { name: "测试菜品21" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(screen.getByRole("button", { name: "测试菜品21" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "测试菜品01" })).toBeNull();
  fireEvent.change(screen.getByPlaceholderText("搜索菜品、销售 SKU、原料或分类"), { target: { value: "肉类" } });
  expect(screen.getByRole("button", { name: "测试菜品21" })).toBeTruthy();
  expect(screen.getByText("共 1 条")).toBeTruthy();
});

it.each([
  ["一键导入全部 SOP", "/api/recipes/sop-import"],
  ["智能匹配已导入原料", "/api/recipes/match-items"],
])("%s 用页面内确认框，取消不发写请求", async (buttonName, url) => {
  const writes: string[] = [];
  const nativeConfirm = vi.spyOn(window, "confirm").mockImplementation(() => { throw new Error("不应调用原生确认框"); });
  vi.stubGlobal("fetch", vi.fn(async (requestUrl: string, options?: RequestInit) => {
    if (options?.method === "POST") writes.push(requestUrl);
    return new Response(JSON.stringify({ recipes: [], message: "已完成" }), { status: 200 });
  }));
  render(<RecipeManager items={items}/>); await screen.findByText("暂无配方。可先从一份 SOP 的一个菜品开始录入验证。");
  fireEvent.click(screen.getByRole("button", { name: buttonName }));
  await screen.findByRole("dialog", { name: "请确认操作" });
  expect(writes).toHaveLength(0); fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(writes).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: buttonName })); fireEvent.click(await screen.findByRole("button", { name: "确认继续" }));
  await waitFor(() => expect(writes).toEqual([url]));
  expect(nativeConfirm).not.toHaveBeenCalled(); nativeConfirm.mockRestore();
});
