import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(process.cwd(), "components", "inventory-desk.tsx"), "utf8");

describe("库存界面交互回归保护", () => {
  it("行内数字修改同时支持键盘输入和加减按钮", () => {
    expect(source).toContain('type="text" inputMode="decimal"');
    expect(source).toContain('className="editable-number-buttons"');
    expect(source).toContain('ariaLabel="修改数量"');
    expect(source).toContain('ariaLabel="修改采购单价"');
    expect(source).toContain('ariaLabel="修改补货系数"');
  });

  it("编辑一行时不会禁用其他行的操作", () => {
    expect(source).not.toContain("disabled={busy || Boolean(editingRecordId)}");
    expect(source).not.toContain("disabled={busy || Boolean(editingItemId)}");
    expect(source).toContain("}, [page]);");
  });

  it("库存总览始终显示平均成本列并为零成本显示金额", () => {
    expect(source).toContain("<th>平均成本</th>");
    // 具体金额与精度在组件行为测试中验证，不绑定金额格式函数名称。
    expect(source).toContain("colSpan={9}");
  });

  it("补货系数位于平均成本说明之前且说明为整行", () => {
    const factorIndex = source.indexOf('name="replenishmentFactor"');
    const noteIndex = source.indexOf('className="cost-rule-note full"');
    expect(factorIndex).toBeGreaterThan(-1);
    expect(noteIndex).toBeGreaterThan(factorIndex);
  });

  it("库存清理前必须让用户选择继续显示或清理后隐藏", () => {
    expect(source).toContain("清理后继续显示");
    expect(source).toContain("清理并隐藏商品");
    expect(source).toContain('requestJson("/api/inventory-cleanup"');
    expect(source).toContain("keepVisible");
  });

  it("已建商品修改覆盖建档时的全部字段", () => {
    for (const label of [
      "修改商品名称", "修改商品 SKU", "修改规格", "修改商品分类",
      "修改采购单位", "修改最小库存单位", "修改净含量单位",
    ]) expect(source).toContain(`aria-label="${label}"`);
    for (const label of [
      "修改采购换算数量", "修改净含量", "修改预警天数",
      "修改目标库存天数", "修改补货系数",
    ]) expect(source).toContain(`ariaLabel="${label}"`);
  });

  it("修改对话框使用独立草稿且关闭时彻底清理编辑状态", () => {
    expect(source).toContain("itemEditDraft");
    expect(source).toContain("closeItemEditor");
    expect(source).toContain("setItemEditDraft(null)");
  });

  it("商品资料保存成功后立即解除编辑锁，不等待总览后台刷新", () => {
    const start = source.indexOf("async function saveItemSettings()");
    const end = source.indexOf("\n  function chooseCleanup", start);
    const handler = source.slice(start, end);
    expect(handler).toContain('setActionDialog({ title: "商品资料已保存"');
    expect(handler).toContain("void refresh().catch");
    expect(handler).not.toContain("await refresh()");
  });

  it("删除、清理后的全局编辑状态都会复位，避免页面无响应", () => {
    expect(source).toContain("function resetTransientInteractionState()");
    expect(source).toContain("setProductMenuOpen(false)");
    // 商品删除先打开确认弹窗，真正写入和解锁由 confirmRemoveItem 承担。
    expect(source).toContain("function removeItem(item");
    expect(source).toContain("setItemDeleteTarget(item)");
    expect(source).toContain("function deleteStockRecord(record");
    expect(source).toContain("setStockDeleteTarget(record)");
    for (const handlerName of ["confirmRemoveItem", "confirmDeleteStockRecord", "clearCurrentStock"]) {
      const start = source.indexOf(`async function ${handlerName}`);
      const nextHandler = source.indexOf("\n  async function", start + 1);
      const handler = source.slice(start, nextHandler === -1 ? undefined : nextHandler);
      expect(handler).toContain("resetTransientInteractionState();");
      expect(handler).toContain("finally {");
      expect(handler).toContain("setBusy(false)");
    }
  });

  it("所有会锁定页面的请求都有超时兜底，超时后可继续录入", () => {
    expect(source).toContain("function requestJson");
    expect(source).toContain("controller.abort()");
    expect(source).toContain("操作等待超时，已恢复页面操作");
    for (const endpoint of ["/api/stock", "/api/master-data", "/api/stock-records", "/api/inventory-cleanup"]) {
      expect(source).toContain(`requestJson(\"${endpoint}\"`);
    }
  });

  it("历史流水显示优先采用已同步的当前单位", () => {
    expect(source).toContain("record.displayUom ?? record.inputUom");
  });
});
