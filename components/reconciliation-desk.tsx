"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileSpreadsheet, RefreshCw, SearchCheck, Download } from "lucide-react";
import { TablePager } from "@/components/table-pager";
import { pageSlice } from "@/lib/domain/inventory-ui";
import { businessDate } from "@/lib/domain/business-date";
import { OperationDialog, useConfirmation } from "@/components/operation-dialog";
import { SearchableChoice } from "@/components/searchable-choice";

type Item = { id: string; name: string; sku: string };
type Warehouse = { id: string; name: string };
type Preview = { fileName: string; fileHash: string; businessDate: string; sheetName: string; lines: { row: number; salesSku: string; dishName: string; quantity: number }[]; warnings: string[]; errors: string[] };
type Candidate = { recipeId: string; recipeName: string; score: number; method: string };
type Data = { pendingSales: Array<{ id: string; warehouseId?: string | null; salesSku: string; dishName: string; quantity: number; matchStatus: string; fileName: string; businessDate: string; candidates: Candidate[] }>; recipeIssues: Array<{ recipeName: string; itemName: string; sku: string; conversionNote: string }>; incompleteItems: Item[]; counts: Array<{ id: string; businessDate: string; mode: string; status: string; note: string; warehouseName: string; lineCount: number; enteredCount: number }>; variance: Array<{ itemId: string; warehouseId: string; warehouseName: string; itemName: string; sku: string; category: string; stockUom: string; theoretical: number; manualOutbound: number; waste: number; countAdjustment: number; actualConsumption: number; variance: number; theoreticalCostCents: number }> };
type Count = { id: string; businessDate: string; mode: "open" | "blind"; status: "draft" | "confirmed"; note: string; warehouseName: string };
type CountLine = { itemId: string; itemName: string; sku: string; category: string; stockUom: string; bookQuantity: number; countedQuantity: number | null; differenceQuantity: number | null; differenceCostCents: number; reason: string };
type CountImportPreview = { fileName: string; validLines: { row: number; itemId: string; itemName: string; countedQuantity: number; reason: string; matchedBy: "SKU" | "商品名称" }[]; errors: string[]; warnings: string[] };

const number = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 }).format(value ?? 0);
const money = (value: number) => `¥${((value ?? 0) / 100).toFixed(2)}`;
const today = businessDate;

async function requestJson(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "请求失败，请稍后重试。");
  return body;
}

export function ReconciliationDesk({ warehouses }: { items: Item[]; warehouses: Warehouse[] }) {
  const { ask, dialog } = useConfirmation();
  const [data, setData] = useState<Data | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState<Count | null>(null);
  const [countLines, setCountLines] = useState<CountLine[]>([]);
  const [countImportPreview, setCountImportPreview] = useState<CountImportPreview | null>(null);
  const [countDate, setCountDate] = useState(today());
  const [countMode, setCountMode] = useState<"open" | "blind">("open");
  const [countHistoryPage, setCountHistoryPage] = useState(1);
  const [countLinePage, setCountLinePage] = useState(1);
  const [variancePage, setVariancePage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [pendingPage, setPendingPage] = useState(1);
  const [issuePage, setIssuePage] = useState(1);
  const [incompletePage, setIncompletePage] = useState(1);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [pendingChoices, setPendingChoices] = useState<Record<string, { recipeId?: string; warehouseId?: string }>>({});
  const defaultWarehouse = warehouses[0]?.id ?? "";

  async function refresh() {
    try { setData(await requestJson("/api/reconciliation")); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "对账数据加载失败"); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    try { const raw = sessionStorage.getItem("inventory-count-draft"); if (raw) { const saved = JSON.parse(raw); setCount(saved.count); setCountLines(saved.lines); } } catch { /* malformed draft is ignored */ }
    setDraftLoaded(true);
  }, []);
  useEffect(() => { if (draftLoaded) { if (count?.status === "draft") sessionStorage.setItem("inventory-count-draft", JSON.stringify({ count, lines: countLines })); else sessionStorage.removeItem("inventory-count-draft"); } }, [count, countLines, draftLoaded]);

  async function chooseSalesFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      setBusy(true); setError(""); setMessage("");
      const form = new FormData(); form.append("file", file);
      setPreview(await requestJson("/api/sales-import/preview", { method: "POST", body: form }));
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "销售文件解析失败"); }
    finally { setBusy(false); event.target.value = ""; }
  }

  async function commitSales() {
    if (!preview || !defaultWarehouse) return;
    try {
      setBusy(true); setError("");
      const result = await requestJson("/api/sales-import/commit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ warehouseId: defaultWarehouse, preview }) });
      setMessage(`销量已导入：精确匹配 ${result.confirmed} 条；待人工确认 ${result.pending} 条；未匹配 ${result.unmatched} 条。理论耗用已生成，但实际库存没有被修改。`);
      setPreview(null); await refresh();
    } catch (commitError) { setError(commitError instanceof Error ? commitError.message : "销售导入失败"); }
    finally { setBusy(false); }
  }

  async function confirmMatch(lineId: string, recipeId: string, warehouseId?: string) {
    if (!recipeId) return;
    const line = data?.pendingSales.find((row) => row.id === lineId);
    if (!line?.warehouseId && !warehouseId) { setError("该旧销量批次没有记录仓库，请先选择原导入仓库，不能自动使用总仓。"); return; }
    try {
      setBusy(true); setError("");
      const result = await requestJson("/api/reconciliation", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ lineId, recipeId, ...(warehouseId ? { warehouseId } : {}) }) });
      setMessage(result.message); await refresh();
    } catch (matchError) { setError(matchError instanceof Error ? matchError.message : "确认匹配失败"); }
    finally { setBusy(false); }
  }

  async function createCount() {
    if (!defaultWarehouse) return;
    try {
      setBusy(true); setError("");
      const result = await requestJson("/api/stock-counts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ warehouseId: defaultWarehouse, businessDate: countDate, mode: countMode, note: "" }) });
      setMessage(`已创建盘点单，共 ${result.lineCount} 个商品。填写实盘数后再确认。`); await openCount(result.id); await refresh();
    } catch (createError) { setError(createError instanceof Error ? createError.message : "创建盘点单失败"); }
    finally { setBusy(false); }
  }

  async function openCount(id: string) {
    try {
      setBusy(true); setError("");
      const result = await requestJson(`/api/stock-counts?id=${encodeURIComponent(id)}`);
      if (count?.status === "draft") await requestJson("/api/stock-counts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ countId: count.id, lines: draftLines() }) });
      // Read after saving so reopening the same draft cannot load stale quantities.
      const fresh = count?.id === id ? await requestJson(`/api/stock-counts?id=${encodeURIComponent(id)}`) : result;
      setCount(fresh.count); setCountLines(fresh.lines); setCountImportPreview(null); setCountLinePage(1);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "盘点单加载失败"); }
    finally { setBusy(false); }
  }

  async function previewCountFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file || !count) return;
    try {
      setBusy(true); setError(""); setMessage("");
      const form = new FormData(); form.append("file", file); form.append("countId", count.id);
      setCountImportPreview(await requestJson("/api/stock-counts/import/preview", { method: "POST", body: form }));
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "盘点表解析失败"); }
    finally { setBusy(false); event.target.value = ""; }
  }

  async function commitCountImport() {
    if (!countImportPreview || !count || countImportPreview.errors.length) return;
    try {
      setBusy(true); setError("");
      const result = await requestJson("/api/stock-counts/import/commit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ countId: count.id, lines: countImportPreview.validLines.map(({ itemId, countedQuantity, reason }) => ({ itemId, countedQuantity, reason })) }) });
      const imported = new Map(countImportPreview.validLines.map((line) => [line.itemId, line]));
      setCountLines((rows) => rows.map((row) => { const value = imported.get(row.itemId); return value ? { ...row, countedQuantity: value.countedQuantity, reason: value.reason, differenceQuantity: value.countedQuantity - row.bookQuantity } : row; }));
      setCountImportPreview(null); setMessage(result.message);
    } catch (commitError) { setError(commitError instanceof Error ? commitError.message : "写入盘点数据失败"); }
    finally { setBusy(false); }
  }

  async function saveCountLine(line: CountLine) {
    if (!count) return;
    try {
      setBusy(true); setError("");
      await requestJson("/api/stock-counts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ countId: count.id, itemId: line.itemId, countedQuantity: line.countedQuantity, reason: line.reason }) });
      setCountLines((rows) => rows.map((row) => row.itemId === line.itemId ? { ...row, differenceQuantity: row.countedQuantity === null ? null : row.countedQuantity - row.bookQuantity } : row));
      setMessage(`“${line.itemName}”已保存，其他未保存输入已保留。`);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "实盘数保存失败"); }
    finally { setBusy(false); }
  }

  function draftLines() { return countLines.map(({ itemId, countedQuantity, reason }) => ({ itemId, countedQuantity, reason })); }
  async function saveAllCountLines() {
    if (!count || busy) return;
    try { setBusy(true); setError(""); await requestJson("/api/stock-counts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ countId: count.id, lines: draftLines() }) }); setMessage("全部盘点输入已保存，库存尚未改变。"); }
    catch (e) { setError(e instanceof Error ? e.message : "保存失败"); } finally { setBusy(false); }
  }
  async function rebaseCount() {
    if (!count || busy || !await ask("将账面数更新到现在。请确认填写的实盘数也对应现在的库存（不是旧时点）；输入会保留，不会自动调整库存。继续？")) return;
    try { setBusy(true); setError(""); await requestJson("/api/stock-counts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ countId: count.id, lines: draftLines() }) }); const fresh = await requestJson("/api/stock-counts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ countId: count.id, action: "rebase" }) }); setCountLines(fresh.lines); setMessage("账面数已更新，请重新核实实盘数，再确认盘点。"); }
    catch (e) { setError(e instanceof Error ? e.message : "重新核对失败"); } finally { setBusy(false); }
  }

  async function confirmCount() {
    if (!count || busy || !await ask("将自动保存当前全部输入，再按盘盈/盘亏差异写入库存流水；确认后不能直接删除。是否确认？")) return;
    try {
      setBusy(true); setError("");
      const result = await requestJson("/api/stock-counts", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ countId: count.id, lines: draftLines() }) });
      setMessage(`盘点已确认，已生成 ${result.adjusted} 条盘盈/盘亏调整流水。`); setCount(null); setCountLines([]); await refresh();
    } catch (confirmError) { setError(confirmError instanceof Error ? confirmError.message : "确认盘点失败"); }
    finally { setBusy(false); }
  }
  async function removeCount(id: string) {
    if (busy || !await ask("删除后本盘点草稿及已填写的实盘数都会清除，是否继续？")) return;
    try { setBusy(true); setError(""); const result = await requestJson(`/api/stock-counts?id=${encodeURIComponent(id)}`, { method: "DELETE" }); setMessage(result.message); if (count?.id === id) { setCount(null); setCountLines([]); } await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "删除盘点草稿失败"); } finally { setBusy(false); }
  }

  const todoCount = (data?.pendingSales.length ?? 0) + (data?.recipeIssues.length ?? 0) + (data?.incompleteItems.length ?? 0);
  const entered = useMemo(() => countLines.filter((line) => line.countedQuantity !== null).length, [countLines]);
  const countHistory = useMemo(() => pageSlice(data?.counts ?? [], countHistoryPage, pageSize), [data, countHistoryPage, pageSize]);
  const countPage = useMemo(() => pageSlice(countLines, countLinePage, pageSize), [countLines, countLinePage, pageSize]);
  const variancePageData = useMemo(() => pageSlice(data?.variance ?? [], variancePage, pageSize), [data, variancePage, pageSize]);
  const pendingPageData = pageSlice(data?.pendingSales ?? [], pendingPage, pageSize);
  const issuePageData = pageSlice(data?.recipeIssues ?? [], issuePage, pageSize);
  const incompletePageData = pageSlice(data?.incompleteItems ?? [], incompletePage, pageSize);
  const pager = (slice: ReturnType<typeof pageSlice>, setPage: (value: number) => void) => <TablePager {...slice} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setCountHistoryPage(1); setCountLinePage(1); setVariancePage(1); }}/>;

  return <>
    {dialog}{(error || message) && <OperationDialog title={error ? "操作未完成" : "操作提示"} onClose={() => { setError(""); setMessage(""); }}><p>{error || message}</p><button type="button" className="primary" onClick={() => { setError(""); setMessage(""); }}>知道了</button></OperationDialog>}
    <div className="inventory-title"><div><h1>库存对账</h1><p>销售数据只生成理论耗用；库存仍以采购、领料、报损和已确认盘点为准。</p></div><button type="button" className="secondary" disabled={busy} onClick={() => void refresh()}><RefreshCw size={16}/>刷新</button></div>
    <div className="reconciliation-safety"><AlertTriangle size={18}/><div><b>先核对，再扣减</b><span>销售 Excel 导入不会改实际库存。只有确认盘点时，盘盈或盘亏才会生成库存调整流水。</span></div></div>
    {message && <div className="recipe-feedback success">{message}</div>}{error && <div className="recipe-feedback error">{error}</div>}

    <section className="inventory-card reconcile-card"><div className="reconcile-head"><div><h2>1. 导入美团销量，生成理论耗用</h2><p>Excel 至少包含“菜品名称”和“销售数量/销量”；销售 SKU 列可选。</p></div><label className="primary file-picker"><FileSpreadsheet size={17}/>选择销售 Excel<input type="file" accept=".xlsx" onChange={chooseSalesFile} disabled={busy}/></label></div>
      {preview && <div className="reconcile-preview"><b>{preview.fileName}</b><span>识别到 {preview.lines.length} 条销量明细 · 业务日期 <input type="date" value={preview.businessDate} onChange={(event) => setPreview({ ...preview, businessDate: event.target.value })}/></span>{preview.warnings.map((warning) => <small key={warning}>{warning}</small>)}{preview.errors.map((issue) => <small className="error-text" key={issue}>{issue}</small>)}<button type="button" className="primary" disabled={busy || Boolean(preview.errors.length)} onClick={() => void commitSales()}>确认导入，生成理论耗用</button></div>}
      {data?.pendingSales.length ? <div className="pending-list"><h3>待确认销售菜品（{data.pendingSales.length}）</h3>{pendingPageData.rows.map((line) => {
        const choice = pendingChoices[line.id] ?? {};
        const choose = (changes: { recipeId?: string; warehouseId?: string }) => setPendingChoices((current) => ({ ...current, [line.id]: { ...current[line.id], ...changes } }));
        return <div className="pending-row" key={line.id}>
          <div><b>{line.dishName}</b><small>{line.salesSku || "无销售 SKU"} · {number(line.quantity)} 份 · {line.businessDate}</small>{line.warehouseId ? <small>原仓库：{warehouses.find((warehouse) => warehouse.id === line.warehouseId)?.name ?? line.warehouseId}</small> : <small className="error-text">旧批次未记录仓库，请先选择实际导入仓库。</small>}</div>
          <div className="pending-match-controls">
            <SearchableChoice options={line.candidates.map((candidate) => ({ id: candidate.recipeId, label: `${candidate.recipeName}（相似度 ${candidate.score}%）` }))} value={choice.recipeId ?? ""} onChange={(recipeId) => choose({ recipeId })} placeholder={`为${line.dishName}选择配方`} disabled={busy}/>
            {!line.warehouseId && <SearchableChoice options={warehouses.map((warehouse) => ({ id: warehouse.id, label: warehouse.name }))} value={choice.warehouseId ?? ""} onChange={(warehouseId) => choose({ warehouseId })} placeholder={`为${line.dishName}选择原仓库`} disabled={busy}/>}
            <button type="button" className="primary" disabled={busy || !choice.recipeId || (!line.warehouseId && !choice.warehouseId)} onClick={() => void confirmMatch(line.id, choice.recipeId!, line.warehouseId ? undefined : choice.warehouseId)}>确认匹配</button>
          </div>
        </div>;
      })}{pager(pendingPageData,setPendingPage)}</div> : <p className="reconcile-ok"><CheckCircle2 size={16}/>暂无待确认的销售菜品。</p>}
    </section>

    <section className="inventory-card reconcile-card"><div className="reconcile-head"><div><h2>2. 批量盘点</h2><p>创建时记录账面数；盲盘模式不显示账面数。确认盘点后才会调整实际库存。</p></div><div className="count-create"><input type="date" value={countDate} onChange={(event) => setCountDate(event.target.value)}/><select value={countMode} onChange={(event) => setCountMode(event.target.value as "open" | "blind")}><option value="open">明盘</option><option value="blind">盲盘</option></select><button type="button" className="primary" disabled={busy} onClick={() => void createCount()}><ClipboardCheck size={16}/>新建盘点单</button></div></div>
      {data?.counts.length ? <><div className="count-history">{countHistory.rows.map((row) => <div key={row.id}><button type="button" onClick={() => void openCount(row.id)} disabled={busy}><b>{row.businessDate} · {row.warehouseName}</b><span>{row.mode === "blind" ? "盲盘" : "明盘"} · {row.status === "confirmed" ? "已确认" : `草稿：已录 ${row.enteredCount}/${row.lineCount}`}</span></button>{row.status === "draft" && <button type="button" className="secondary danger-button" disabled={busy} onClick={() => void removeCount(row.id)}>删除草稿</button>}</div>)}</div>{pager(countHistory,setCountHistoryPage)}</> : <p className="empty">暂无盘点单。</p>}
      {count && <div className="count-editor">{error && <div role="alert" className="recipe-feedback error">{error}</div>}{message && <div role="status" className="recipe-feedback success">{message}</div>}<div className="count-editor-head"><div><b>{count.businessDate} · {count.warehouseName}</b><small>{count.mode === "blind" ? "盲盘：不显示账面数量。" : "明盘：可对照账面数量。"} 已填写 {entered}/{countLines.length} 项。</small></div><div>{count.status === "draft" && <><button type="button" className="secondary" disabled={busy} onClick={() => void saveAllCountLines()}>保存全部输入</button><button type="button" className="secondary" disabled={busy} onClick={() => void rebaseCount()}>重新核对账面数</button></>}<a className="secondary" href={`/api/stock-counts/template?id=${encodeURIComponent(count.id)}`}><Download size={15}/>下载打印盘点表</a>{count.status === "draft" && <button type="button" className="primary" disabled={busy || !entered} onClick={() => void confirmCount()}>确认盘点并调整库存</button>}</div></div>{count.status === "draft" && <div className="count-import"><div><b>回传已填写的盘点 Excel</b><small>支持本页面下载的 .xlsx 模板。系统先逐行预览；有问题的行不会写入库存。</small></div><label className="secondary file-picker"><FileSpreadsheet size={15}/>选择回传表<input type="file" accept=".xlsx" onChange={previewCountFile} disabled={busy}/></label></div>}{countImportPreview && <div className="reconcile-preview count-import-preview"><b>{countImportPreview.fileName}：可写入 {countImportPreview.validLines.length} 条</b>{countImportPreview.validLines.slice(0, 8).map((line) => <small key={line.itemId}>第 {line.row} 行 · {line.itemName} · {number(line.countedQuantity)}（按{line.matchedBy}匹配）</small>)}{countImportPreview.warnings.map((issue) => <small key={issue}>{issue}</small>)}{countImportPreview.errors.map((issue) => <small className="error-text" key={issue}>{issue}</small>)}<button type="button" className="primary" disabled={busy || !countImportPreview.validLines.length || Boolean(countImportPreview.errors.length)} onClick={() => void commitCountImport()}>确认写入盘点草稿</button></div>}<div className="stock-table-wrap"><table className="stock-table count-table"><thead><tr><th>商品</th>{count.mode === "open" && <th>账面数</th>}<th>实盘数</th>{count.mode === "open" && <th>差异</th>}<th>原因</th><th>保存</th></tr></thead><tbody>{countPage.rows.map((line) => { const index=countLines.findIndex((row)=>row.itemId===line.itemId); return <tr key={line.itemId}><td><b>{line.itemName}</b><small>{line.sku} · {line.stockUom}</small></td>{count.mode === "open" && <td>{number(line.bookQuantity)} {line.stockUom}</td>}<td><input aria-label={`${line.itemName}实盘数`} type="number" min="0" step="0.001" disabled={busy || count.status !== "draft"} value={line.countedQuantity ?? ""} onChange={(event) => setCountLines((rows) => rows.map((row, pos) => pos === index ? { ...row, countedQuantity: event.target.value === "" ? null : Number(event.target.value) } : row))}/></td>{count.mode === "open" && <td>{line.differenceQuantity === null ? "—" : `${number(line.differenceQuantity)} ${line.stockUom}`}</td>}<td><input aria-label={`${line.itemName}盘点原因`} disabled={busy || count.status !== "draft"} value={line.reason} onChange={(event) => setCountLines((rows) => rows.map((row, pos) => pos === index ? { ...row, reason: event.target.value } : row))} placeholder="如 损耗、漏记"/></td><td>{count.status === "draft" && <button type="button" className="secondary" disabled={busy} onClick={() => void saveCountLine(line)}>保存</button>}</td></tr>; })}</tbody></table></div>{pager(countPage,setCountLinePage)}</div>}
    </section>

    <section className="inventory-card reconcile-card"><div className="reconcile-head"><div><h2>3. 理论与实际差异</h2><p>按商品和仓库分别核对。正数表示“人工出库 + 报损”高于理论耗用；不包含未确认盘点的草稿数据。</p></div></div><div className="stock-table-wrap"><table className="stock-table variance-table"><thead><tr><th>商品 / 仓库</th><th>理论耗用</th><th>人工实际出库</th><th>报损</th><th>盘点调整</th><th>差异</th></tr></thead><tbody>{variancePageData.rows.length ? variancePageData.rows.map((row) => <tr key={`${row.itemId}:${row.warehouseId}`}><td><b>{row.itemName}</b><small>{row.sku} · {row.category}</small><small>{row.warehouseName || "仓库待核对"}</small></td><td>{number(row.theoretical)} {row.stockUom}<small>{money(row.theoreticalCostCents)}</small></td><td>{number(row.manualOutbound)} {row.stockUom}</td><td>{number(row.waste)} {row.stockUom}</td><td>{number(row.countAdjustment)} {row.stockUom}</td><td className={row.variance > 0 ? "variance-bad" : row.variance < 0 ? "variance-good" : ""}>{number(row.variance)} {row.stockUom}</td></tr>) : <tr><td colSpan={6} className="empty">导入销售数据后，这里会显示理论耗用与实际出库的差异。</td></tr>}</tbody></table></div>{pager(variancePageData,setVariancePage)}</section>

    <section className="inventory-card reconcile-card todo-card"><div className="reconcile-head"><div><h2>4. 数据待办（{todoCount}）</h2><p>这些问题不会阻止其他正确数据运行，但处理后理论耗用会更准确。</p></div></div><div className="todo-grid"><div><b>待确认销售菜品</b><strong>{data?.pendingSales.length ?? 0}</strong><span>相似菜名或没有匹配到配方</span></div><div><b>待处理配方原料</b><strong>{data?.recipeIssues.length ?? 0}</strong><span>单位或净含量暂不能换算</span></div><div><b>资料不完整商品</b><strong>{data?.incompleteItems.length ?? 0}</strong><span>缺最小单位、净含量或换算数量</span></div></div>{data?.recipeIssues.length ? <ul className="todo-details">{issuePageData.rows.map((issue, index) => <li key={`${issue.recipeName}-${index}`}>“{issue.recipeName}”→“{issue.itemName}”：{issue.conversionNote}</li>)}</ul> : null}{pager(issuePageData,setIssuePage)}{incompletePageData.rows.length > 0 && <ul className="todo-details">{incompletePageData.rows.map((item) => <li key={item.id}>{item.name} · {item.sku}：请补全商品单位或净含量。</li>)}</ul>}{pager(incompletePageData,setIncompletePage)}</section>
  </>;
}
