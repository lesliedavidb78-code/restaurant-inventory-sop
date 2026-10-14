"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { AlertTriangle, BookOpenCheck, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { calculateRawInputQuantity, convertRecipeQuantityToStockUnit } from "@/lib/domain/recipe";
import { pageSlice } from "@/lib/domain/inventory-ui";
import { TablePager } from "@/components/table-pager";
import { OperationDialog, useConfirmation } from "@/components/operation-dialog";

type ItemOption = {
  id: string; name: string; sku: string; category: string; stockUom: string;
  unitNetContent: number; contentUom: string; specification: string;
};

type RecipeLine = {
  itemId: string; sourceQuantity: string; sourceUom: string; yieldRate: string; keyword: string;
};

type StoredRecipeLine = {
  id: string; itemId: string; itemName: string; sku: string; stockUom: string;
  sourceQuantity: number; sourceUom: string; yieldRate: number; stockQuantity: number; conversionStatus: "ready" | "pending"; conversionNote: string;
};

type StoredRecipe = {
  id: string; name: string; salesSku: string; portionQty: number; portionUom: string;
  sourceType: "manual" | "sop"; sourceName: string; note: string; active: number | boolean;
  updatedAt: string; lines: StoredRecipeLine[];
};

type RecipeDraft = {
  id?: string; name: string; salesSku: string; portionQty: string; portionUom: string;
  sourceType: "manual" | "sop"; sourceName: string; note: string; active: boolean; lines: RecipeLine[];
};

const blankLine = (): RecipeLine => ({ itemId: "", sourceQuantity: "", sourceUom: "g", yieldRate: "100", keyword: "" });
const blankDraft = (): RecipeDraft => ({ name: "", salesSku: "", portionQty: "1", portionUom: "份", sourceType: "manual", sourceName: "", note: "", active: true, lines: [blankLine()] });
const displayQuantity = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value);
const recipeDraftKey = "store-inventory-recipe-draft-v1";

function hasDraftContent(draft: RecipeDraft) {
  return Boolean(draft.id || draft.name.trim() || draft.salesSku.trim() || draft.sourceName.trim() || draft.note.trim() || draft.lines.some((line) => line.itemId || line.keyword.trim() || line.sourceQuantity));
}

async function requestJson(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "请求失败，请稍后重试。");
  return result;
}

export function RecipeManager({ items }: { items: ItemOption[] }) {
  const [recipes, setRecipes] = useState<StoredRecipe[]>([]);
  const [draft, setRecipeDraft] = useState<RecipeDraft>(blankDraft);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pendingNotes, setPendingNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<StoredRecipe | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [recipeSearch, setRecipeSearch] = useState("");
  const [recipePage, setRecipePage] = useState(1);
  const [recipePageSize, setRecipePageSize] = useState(20);
  const [pendingNotePage, setPendingNotePage] = useState(1);
  const [pendingNotePageSize, setPendingNotePageSize] = useState(20);
  const { ask, dialog } = useConfirmation();
  const mutationBusy = useRef(false);
  function setDraft(next: SetStateAction<RecipeDraft>) {
    if (!mutationBusy.current) setRecipeDraft(next);
  }
  function beginMutation() {
    if (mutationBusy.current) return false;
    mutationBusy.current = true; setBusy(true); return true;
  }
  function endMutation() { mutationBusy.current = false; setBusy(false); }

  async function loadRecipes() {
    setLoading(true);
    try {
      const result = await requestJson("/api/recipes");
      setRecipes(result.recipes ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "配方列表加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadRecipes(); }, []);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(recipeDraftKey);
      if (raw) {
        const restored = JSON.parse(raw) as RecipeDraft;
        if (Array.isArray(restored.lines)) {
          setDraft({ ...blankDraft(), ...restored, lines: restored.lines.length ? restored.lines : [blankLine()] });
          setMessage("已恢复未保存的配方草稿。");
        }
      }
    } catch { window.sessionStorage.removeItem(recipeDraftKey); }
    setDraftReady(true);
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    if (hasDraftContent(draft)) window.sessionStorage.setItem(recipeDraftKey, JSON.stringify(draft));
    else window.sessionStorage.removeItem(recipeDraftKey);
  }, [draft, draftReady]);

  function clearDraft() {
    if (mutationBusy.current) return;
    setRecipeDraft(blankDraft());
    window.sessionStorage.removeItem(recipeDraftKey);
  }

  function clearSubmittedDraft(submitted: RecipeDraft) {
    // 离开再返回会创建新组件实例；旧请求只能清理它提交的同一版本草稿。
    if (window.sessionStorage.getItem(recipeDraftKey) !== JSON.stringify(submitted)) return;
    setRecipeDraft(blankDraft());
    window.sessionStorage.removeItem(recipeDraftKey);
  }

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const filteredRecipes = useMemo(() => {
    const keyword = recipeSearch.trim().toLocaleLowerCase();
    return recipes.filter((recipe) => !keyword || `${recipe.name} ${recipe.salesSku} ${recipe.sourceName} ${recipe.lines.map((line) => `${line.itemName} ${line.sku} ${itemById.get(line.itemId)?.category ?? ""}`).join(" ")}`.toLocaleLowerCase().includes(keyword));
  }, [recipes, recipeSearch, itemById]);
  const recipePageData = pageSlice(filteredRecipes, recipePage, recipePageSize);
  const pendingNotePageData = pageSlice(pendingNotes, pendingNotePage, pendingNotePageSize);
  useEffect(() => { setPendingNotePage(1); }, [pendingNotes]);

  function updateLine(index: number, changes: Partial<RecipeLine>) {
    setDraft((current) => ({ ...current, lines: current.lines.map((line, row) => row === index ? { ...line, ...changes } : line) }));
  }

  function selectedItem(line: RecipeLine) { return itemById.get(line.itemId); }

  function conversionHint(line: RecipeLine) {
    const item = selectedItem(line);
    if (!item || !line.sourceQuantity) return "先选择原料并填写 SOP 用量";
    try {
      const rawInputQuantity = calculateRawInputQuantity(Number(line.sourceQuantity), Number(line.yieldRate || 100));
      const converted = convertRecipeQuantityToStockUnit({ sourceQuantity: rawInputQuantity, sourceUom: line.sourceUom, stockUom: item.stockUom, unitNetContent: item.unitNetContent, contentUom: item.contentUom, specification: item.specification });
      const yieldCopy = Number(line.yieldRate || 100) === 100 ? "" : `（进料率 ${line.yieldRate}%，原料投料 ${displayQuantity(rawInputQuantity)} ${line.sourceUom}）`;
      return `每份理论耗用：${displayQuantity(converted.stockQuantity)} ${converted.stockUom}${yieldCopy}`;
    } catch (conversionError) {
      const reason = conversionError instanceof Error ? conversionError.message : "单位换算失败";
      return `原料“${item.name}”（${item.sku}）：SOP 单位 ${line.sourceUom}，库存单位 ${item.stockUom}；${reason}`;
    }
  }

  function editRecipe(recipe: StoredRecipe) {
    if (mutationBusy.current) return;
    setError(""); setMessage("");
    setDraft({
      id: recipe.id, name: recipe.name, salesSku: recipe.salesSku, portionQty: String(recipe.portionQty), portionUom: recipe.portionUom,
      sourceType: recipe.sourceType, sourceName: recipe.sourceName, note: recipe.note, active: Boolean(recipe.active),
      lines: recipe.lines.map((line) => ({ itemId: line.itemId, sourceQuantity: String(line.sourceQuantity), sourceUom: line.sourceUom, yieldRate: String(line.yieldRate ?? 100), keyword: line.itemName })),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage(""); setPendingNotes([]);
    if (mutationBusy.current) return;
    if (!draft.name.trim()) { setError("请填写菜品名称。"); return; }
    if (!Number.isFinite(Number(draft.portionQty)) || Number(draft.portionQty) <= 0 || !draft.portionUom.trim()) { setError("请填写有效的每份数量和销售单位。"); return; }
    if (!draft.lines.length || draft.lines.some((line) => !line.itemId || !line.sourceQuantity || !Number.isFinite(Number(line.sourceQuantity)) || Number(line.sourceQuantity) <= 0 || !line.sourceUom.trim() || !line.yieldRate || !Number.isFinite(Number(line.yieldRate)) || Number(line.yieldRate) <= 0 || Number(line.yieldRate) > 100)) {
      setError("请为每一条原料选择商品，并填写有效的 SOP 用量、单位和 0%～100% 的进料率。"); return;
    }
    if (!beginMutation()) return;
    try {
      const body = {
        id: draft.id, name: draft.name.trim(), salesSku: draft.salesSku.trim(), portionQty: Number(draft.portionQty), portionUom: draft.portionUom.trim(),
        sourceType: draft.sourceType, sourceName: draft.sourceName.trim(), note: draft.note.trim(), active: draft.active,
        lines: draft.lines.map((line) => ({ itemId: line.itemId, sourceQuantity: Number(line.sourceQuantity), sourceUom: line.sourceUom.trim(), yieldRate: Number(line.yieldRate) })),
      };
      const result = await requestJson("/api/recipes", { method: draft.id ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      setMessage(result.message || "配方已保存。");
      setPendingNotes(result.pendingLines ?? []);
      clearSubmittedDraft(draft);
      await loadRecipes();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "配方保存失败");
    } finally { endMutation(); }
  }

  async function deleteRecipe() {
    if (!deleteTarget) return;
    if (!beginMutation()) return;
    try {
      setBusy(true); setError(""); setMessage(""); setPendingNotes([]);
      const result = await requestJson("/api/recipes", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: deleteTarget.id }) });
      setMessage(result.message || "配方已删除。");
      if (draft.id === deleteTarget.id) clearSubmittedDraft(draft);
      setDeleteTarget(null);
      await loadRecipes();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "配方删除失败");
    } finally { endMutation(); }
  }

  async function importRecognizedSop() {
    if (mutationBusy.current) return;
    const confirmed = await ask("将一键导入产品2.0菜品 PDF、甜品产品成本卡和锅底 SOP。库存中没有的原料会以“SOP原料待完善”自动建档；可换算的原料会直接保存，无法换算的单条会标明原因但不会阻断整批导入。采购规格、成本和待处理单位仍需门店核对。是否继续？");
    if (!confirmed || !beginMutation()) return;
    try {
      setBusy(true); setError(""); setMessage("");
      const result = await requestJson("/api/recipes/sop-import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ createMissing: true }) });
      const pending = result.placeholders?.length ? `；其中 ${result.placeholders.length} 个原料已标为“SOP原料待完善”` : "";
      setMessage(`${result.message || "SOP 已导入"}${pending}。`);
      setPendingNotes(result.pendingLines ?? []);
      await loadRecipes();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "SOP 导入失败");
    } finally { endMutation(); }
  }

  async function smartMatchImportedItems() {
    if (mutationBusy.current) return;
    const confirmed = await ask("系统只会自动绑定“别名一致”或“高置信度相似”的库存商品；名称不够确定的原料不会自动修改，会保留给你在“修改配方”中手工选择。是否开始智能匹配？");
    if (!confirmed || !beginMutation()) return;
    try {
      setBusy(true); setError(""); setMessage(""); setPendingNotes([]);
      const result = await requestJson("/api/recipes/match-items", { method: "POST" });
      setMessage(result.message || "智能匹配已完成。");
      const notes = (result.pending ?? []).map((entry: { recipeName: string; ingredient: string; candidates?: string[] }) => {
        const candidates = entry.candidates?.length ? ` 候选：${entry.candidates.join("、")}` : " 未找到可靠候选。";
        return `菜品“${entry.recipeName}”的原料“${entry.ingredient}”未自动绑定。${candidates}`;
      });
      setPendingNotes(notes);
      await loadRecipes();
    } catch (matchError) {
      setError(matchError instanceof Error ? matchError.message : "智能匹配失败");
    } finally { endMutation(); }
  }

  return <>
    {dialog}
    <div className="inventory-title recipe-title"><div><h1>配方管理</h1><p>维护菜品 SOP 与原料用量，为后续销售数据导入后的理论耗用做准备。</p></div><div className="recipe-title-actions"><button type="button" className="secondary" disabled={busy} onClick={() => void smartMatchImportedItems()}><RefreshCw size={17}/>智能匹配已导入原料</button><button type="button" className="secondary" disabled={busy} onClick={() => void importRecognizedSop()}><BookOpenCheck size={17}/>一键导入全部 SOP</button><button type="button" className="secondary" disabled={busy} onClick={() => { clearDraft(); setError(""); setMessage(""); }}><Plus size={17}/>新建配方</button></div></div>
    <div className="recipe-safety-note"><AlertTriangle size={18}/><div><b>当前仅保存配方，不会自动扣库存</b><span>库存仍以采购、领料、报损等库存作业为准。接入收银或导入销售单后，系统会按“销售 SKU 精确匹配 → 菜名精确匹配 → 相似菜名候选”匹配配方；相似候选必须由门店人工确认，才会用于理论耗用。</span></div></div>
    {message && <div className="recipe-feedback success">{message}</div>}
    {pendingNotes.length > 0 && <div className="recipe-feedback warning"><b>以下原料已保存，但暂不参与理论耗用计算：</b><ul>{pendingNotePageData.rows.map((note, index) => <li key={`${pendingNotePage}-${index}`}>{note}</li>)}</ul><span>请在商品建档补齐该商品的最小单位、净含量与单位，或把 SOP 单位改为对应单位后重新保存配方。</span><TablePager {...pendingNotePageData} onPageChange={setPendingNotePage} onPageSizeChange={(size) => { setPendingNotePageSize(size); setPendingNotePage(1); }}/></div>}
    {error && <div className="recipe-feedback error">{error}</div>}
    <form className="recipe-editor inventory-card" onSubmit={saveRecipe} noValidate>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="recipe-editor-heading"><div><h2>{draft.id ? "修改菜品配方" : "新建菜品配方"}</h2><p>一份菜品对应多条原料；用量可使用 g、两、斤、kg、ml、袋、包等单位。未保存草稿在切换页面时会保留。</p></div>{draft.id && <button type="button" className="secondary" onClick={() => clearDraft()}>取消修改</button>}</div>
      <div className="recipe-form-grid">
        <label>菜品名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：石磨豆腐丝" maxLength={80}/></label>
        <label>销售 SKU（可选）<input value={draft.salesSku} onChange={(event) => setDraft({ ...draft, salesSku: event.target.value })} placeholder="后续对接收银菜品编码" maxLength={60}/></label>
        <label>每份数量<input type="number" inputMode="decimal" min="0.01" step="0.01" value={draft.portionQty} onChange={(event) => setDraft({ ...draft, portionQty: event.target.value })}/></label>
        <label>销售单位<input value={draft.portionUom} onChange={(event) => setDraft({ ...draft, portionUom: event.target.value })} placeholder="份" maxLength={12}/></label>
        <label>SOP 来源<select value={draft.sourceType} onChange={(event) => setDraft({ ...draft, sourceType: event.target.value as "manual" | "sop" })}><option value="manual">手工录入</option><option value="sop">产品 SOP</option></select></label>
        <label>SOP 文件/来源备注<input value={draft.sourceName} onChange={(event) => setDraft({ ...draft, sourceName: event.target.value })} placeholder="例如：凉菜 SOP.docx" maxLength={160}/></label>
        <label>状态<select value={draft.active ? "true" : "false"} onChange={(event) => setDraft({ ...draft, active: event.target.value === "true" })}><option value="true">启用：后续参与理论耗用</option><option value="false">停用：仅保留历史配方</option></select></label>
        <label className="full">备注<input value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="例如：按标准份量；特殊订单另行处理" maxLength={500}/></label>
      </div>
      <div className="recipe-lines-heading"><div><h3>配方原料</h3><p>每一条都要选择已建库存商品。进料率默认 100%；例如进料率 90%，100g 可用牛肉将按 111.111g 原料计算理论耗用。</p></div><button type="button" className="secondary" onClick={() => setDraft((current) => ({ ...current, lines: [...current.lines, blankLine()] }))}><Plus size={16}/>添加原料</button></div>
      <div className="recipe-lines">
        {draft.lines.map((line, index) => {
          const matches = items.filter((item) => `${item.name} ${item.sku} ${item.category}`.toLocaleLowerCase().includes(line.keyword.trim().toLocaleLowerCase())).slice(0, 80);
          const hint = conversionHint(line);
          const isIssue = hint.includes("无法换算") || hint.includes("单位换算失败");
          return <div className="recipe-line" key={`${line.itemId}-${index}`}>
            <span className="recipe-line-index">{index + 1}</span>
            <div className="recipe-item-picker"><label>原料（输入后直接选择）</label><div className="recipe-picker-input"><Search size={17}/><input aria-label={`搜索配方原料 ${index + 1}`} value={line.keyword} onChange={(event) => updateLine(index, { keyword: event.target.value, itemId: "" })} placeholder="输入名称、分类或 SKU"/>{line.itemId && <button type="button" aria-label="清除已选原料" onClick={() => updateLine(index, { itemId: "", keyword: "" })}><X size={15}/></button>}</div>{line.keyword.trim() && !line.itemId && <div className="recipe-picker-options">{matches.length ? matches.map((item) => <button type="button" key={item.id} onClick={() => updateLine(index, { itemId: item.id, keyword: `${item.name}（${item.sku}）` })}>{item.name}<small>{item.sku} · {item.category} · {item.stockUom}</small></button>) : <p>没有找到原料，请先在商品建档中创建。</p>}</div>}{line.itemId && <small className="selected-item-note">已选择：{selectedItem(line)?.name}（{selectedItem(line)?.sku}）</small>}</div>
            <label>SOP 用量<input aria-label={`原料用量 ${index + 1}`} type="number" inputMode="decimal" min="0.0001" step="0.0001" value={line.sourceQuantity} onChange={(event) => updateLine(index, { sourceQuantity: event.target.value })} placeholder="例如：100"/></label>
            <label>SOP 单位<input aria-label={`原料单位 ${index + 1}`} value={line.sourceUom} onChange={(event) => updateLine(index, { sourceUom: event.target.value })} placeholder="例如：g" maxLength={12}/></label>
            <label>进料率（%）<input aria-label={`原料进料率 ${index + 1}`} type="number" inputMode="decimal" min="0.01" max="100" step="0.01" value={line.yieldRate} onChange={(event) => updateLine(index, { yieldRate: event.target.value })} placeholder="100"/></label>
            <div className={isIssue ? "recipe-conversion issue" : "recipe-conversion"}>{hint}</div>
            <button type="button" className="icon-button danger" aria-label={`删除原料 ${index + 1}`} disabled={draft.lines.length === 1} onClick={() => setDraft((current) => ({ ...current, lines: current.lines.filter((_, row) => row !== index) }))}><X size={17}/></button>
          </div>;
        })}
      </div>
      <div className="form-action"><button className="primary" disabled={busy}>{busy ? "正在保存…" : draft.id ? "保存修改" : "保存配方"}</button></div>
      </fieldset>
    </form>
    <section className="inventory-card recipe-list-card"><div className="recipe-list-heading"><div><h2>已建配方</h2><p>已保存 {recipes.length} 个菜品配方。停用后不会进入后续理论耗用计算。</p></div><button type="button" className="secondary" onClick={() => void loadRecipes()} disabled={loading || busy}><RefreshCw size={16}/>刷新</button></div>
      <div className="stock-tools"><label><Search size={16}/><input value={recipeSearch} onChange={(event) => { setRecipeSearch(event.target.value); setRecipePage(1); }} placeholder="搜索菜品、销售 SKU、原料或分类"/></label></div>
      {loading ? <p className="empty">正在加载配方…</p> : filteredRecipes.length === 0 ? <p className="empty">{recipes.length ? "没有匹配的配方，请更换关键词。" : "暂无配方。可先从一份 SOP 的一个菜品开始录入验证。"}</p> : <div className="recipe-table-wrap"><table className="recipe-table"><thead><tr><th>菜品</th><th>份量</th><th>原料与理论耗用</th><th>SOP 来源</th><th>状态</th><th>操作</th></tr></thead><tbody>{recipePageData.rows.map((recipe) => <tr key={recipe.id}>
        <td><button type="button" className="recipe-name-button" disabled={busy} onClick={() => editRecipe(recipe)} title={`修改“${recipe.name}”配方`}><b>{recipe.name}</b></button><small>{recipe.salesSku || "未绑定销售 SKU"}</small><button type="button" className="recipe-edit-link" disabled={busy} onClick={() => editRecipe(recipe)}><Pencil size={13}/>修改配方</button></td>
        <td>{displayQuantity(recipe.portionQty)} {recipe.portionUom}</td><td><ul>{recipe.lines.map((line) => <li key={line.id}>{line.itemName}：{displayQuantity(line.sourceQuantity)} {line.sourceUom}（进料率 {displayQuantity(line.yieldRate ?? 100)}%） {line.conversionStatus === "pending" ? <span className="recipe-line-pending">待处理：{line.conversionNote}</span> : <span>→ {displayQuantity(line.stockQuantity)} {line.stockUom}</span>}</li>)}</ul></td>
        <td>{recipe.sourceType === "sop" ? "产品 SOP" : "手工录入"}<small>{recipe.sourceName || "—"}</small></td><td><span className={recipe.active ? "recipe-status active" : "recipe-status"}>{recipe.active ? "启用" : "停用"}</span></td><td className="recipe-actions"><button type="button" className="secondary" disabled={busy} onClick={() => editRecipe(recipe)}><Pencil size={15}/>编辑</button><button type="button" className="danger-button" disabled={busy} onClick={() => setDeleteTarget(recipe)}><Trash2 size={15}/>删除</button></td>
      </tr>)}</tbody></table></div>}
      <TablePager {...recipePageData} onPageChange={setRecipePage} onPageSizeChange={(size) => { setRecipePageSize(size); setRecipePage(1); }}/>
    </section>
    {deleteTarget && <OperationDialog title="删除配方？" onClose={() => { if (!busy) setDeleteTarget(null); }}><p>删除或停用“{deleteTarget.name}”。有历史销售引用时只会停用，保留原料与理论耗用历史；不会改变实际库存。</p><footer><button type="button" className="secondary" onClick={() => setDeleteTarget(null)} disabled={busy}>取消</button><button type="button" className="danger-button" onClick={() => void deleteRecipe()} disabled={busy}>{busy ? "正在处理…" : "确认删除"}</button></footer></OperationDialog>}
  </>;
}
