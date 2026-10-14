"use client";

import { useMemo, useRef, useState } from "react";
import type { getDashboard } from "@/lib/services";
import type { SessionContext } from "@/lib/auth";
import { ArchiveRestore, ArrowDownToLine, Banknote, BookCheck, Boxes, CalendarDays, Check, ChevronRight, CircleDollarSign, ClipboardCheck, Eye, FileSpreadsheet, LayoutDashboard, LoaderCircle, LockKeyhole, PackagePlus, Plus, ReceiptText, RefreshCw, Search, ShieldCheck, Trash2, TrendingDown, TrendingUp, Upload, UsersRound, Warehouse } from "lucide-react";

type DashboardData = Awaited<ReturnType<typeof getDashboard>>;
type Section = "overview" | "gross" | "stock" | "import" | "funds" | "close";

const yuan = (cents = 0) => new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2 }).format(cents / 100);
const number = (value = 0) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
const pct = (value = 0) => `${(value * 100).toFixed(2)}%`;
const periodLabel = (period: string) => {
  const [year, month] = period.split("-");
  return `${year}年${Number(month)}月`;
};

const nav: { id: Section; label: string; hint: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "经营总览", hint: "利润与趋势", icon: LayoutDashboard },
  { id: "gross", label: "档口毛利", hint: "成本与折扣", icon: CircleDollarSign },
  { id: "stock", label: "库存作业", hint: "流水与预警", icon: Boxes },
  { id: "import", label: "数据导入", hint: "预览与对账", icon: FileSpreadsheet },
  { id: "funds", label: "资金往来", hint: "银行与账期", icon: Banknote },
  { id: "close", label: "月结中心", hint: "复核与锁定", icon: BookCheck },
];

function Metric({ label, value, helper, tone = "ink" }: { label: string; value: string; helper: string; tone?: "ink" | "red" | "green" }) {
  return <article className={`metric metric-${tone}`}><span>{label}</span><strong>{value}</strong><small>{helper}</small></article>;
}

function Trend({ data }: { data: DashboardData["trends"] }) {
  const values = data.map((x) => x.revenueCents / 100);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const points = values.map((v, i) => `${32 + i * 102},${164 - ((v - min) / (max - min || 1)) * 108}`).join(" ");
  return <div className="trend-wrap">
    <svg viewBox="0 0 575 205" role="img" aria-label="一至六月营业额趋势">
      <defs><linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1769e8" stopOpacity=".20"/><stop offset="1" stopColor="#1769e8" stopOpacity="0"/></linearGradient></defs>
      {[56,92,128,164].map((y) => <line key={y} x1="32" x2="548" y1={y} y2={y} className="grid-line" />)}
      <polygon points={`${points} 542,178 32,178`} fill="url(#lineFill)" />
      <polyline points={points} fill="none" className="trend-line" />
      {values.map((v, i) => { const [x,y] = points.split(" ")[i].split(","); return <g key={data[i].period}><circle cx={x} cy={y} r="5" className="trend-dot"/><text x={x} y="198" textAnchor="middle">{Number(data[i].period.slice(5))}月</text>{i === values.length-1 && <text x={x} y={Number(y)-14} textAnchor="middle" className="peak">¥{Math.round(v/1000)}k</text>}</g>; })}
    </svg>
  </div>;
}

export function OperatingDesk({ initialData, session }: { initialData: DashboardData; session: SessionContext }) {
  const [data, setData] = useState(initialData);
  const [section, setSection] = useState<Section>("overview");
  const role = session.role;
  const [period, setPeriod] = useState(initialData.period);
  const [stockSearch, setStockSearch] = useState("");
  const [stockWarningOnly, setStockWarningOnly] = useState(false);
  const [stockItemId, setStockItemId] = useState(initialData.items[0]?.id ?? "");
  const [quantityUom, setQuantityUom] = useState<"purchase" | "stock">("purchase");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [marginPreview, setMarginPreview] = useState<any>(null);
  const [editingParty, setEditingParty] = useState<DashboardData["parties"][number] | null>(null);
  const [memberOpen, setMemberOpen] = useState(false);
  const [memberForm, setMemberForm] = useState({ username: "", displayName: "", password: "", role: "finance" });
  const fileRef = useRef<HTMLInputElement>(null);
  const marginFileRef = useRef<HTMLInputElement>(null);
  const maxBooth = Math.max(0, ...data.gross.map((x) => x.grossRevenueCents));
  const payable = data.parties.filter((x) => x.kind === "payable").reduce((s, x) => s + x.originalCents - x.settledCents, 0);
  const receivable = data.parties.filter((x) => x.kind === "receivable").reduce((s, x) => s + x.originalCents - x.settledCents, 0);
  const lowStock = data.stock.filter((x) => x.quantity < x.minimumQty);
  const closed = data.close?.status === "closed";
  const availablePeriods = useMemo(() => data.trends.map((item) => item.period).sort().reverse(), [data.trends]);
  const selectedItem = data.items.find((item) => item.id === stockItemId) ?? data.items[0];
  const filteredStock = useMemo(() => {
    const keyword = stockSearch.trim().toLocaleLowerCase("zh-CN");
    return data.stock.filter((item) => (!stockWarningOnly || item.quantity < item.minimumQty) && (!keyword || [item.itemName, item.sku, item.category].some((value) => value.toLocaleLowerCase("zh-CN").includes(keyword))));
  }, [data.stock, stockSearch, stockWarningOnly]);

  async function refresh(targetPeriod = period) {
    const next = await fetch(`/api/dashboard?period=${targetPeriod}`, { cache: "no-store" }).then((r) => r.json());
    setData(next);
  }

  async function changeStore(storeId: string) {
    if (storeId === session.storeId) return;
    const res = await fetch("/api/stores/select", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ storeId }) });
    if (!res.ok) return setNotice("门店切换失败，请重新登录后再试。");
    window.location.reload();
  }

  async function addStore() {
    const name = window.prompt("请输入新门店名称，例如：示例门店");
    if (!name) return;
    const code = window.prompt("请输入门店编码（英文、数字、-、_），例如：DEMO-001");
    if (!code) return;
    const res = await fetch("/api/stores", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, code }) }); const body = await res.json();
    if (!res.ok) return setNotice(body.error ?? "新增门店失败");
    await changeStore(body.storeId);
  }

  async function submitMember() {
    setBusy(true); setNotice("");
    const res = await fetch("/api/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(memberForm) });
    const body = await res.json(); setBusy(false);
    if (!res.ok) return setNotice(body.error ?? "新建成员失败");
    setMemberOpen(false); setMemberForm({ username: "", displayName: "", password: "", role: "finance" }); setNotice(`已创建 ${body.displayName} 账号，可使用该账号和初始密码登录。`);
  }

  async function changePeriod(nextPeriod: string) {
    setBusy(true); setNotice("");
    try {
      await refresh(nextPeriod);
      setPeriod(nextPeriod);
    } catch {
      setNotice("账期数据加载失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function previewFile(file: File) {
    setBusy(true); setNotice("");
    const form = new FormData(); form.append("file", file);
    const res = await fetch("/api/imports/preview", { method: "POST", body: form });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) return setNotice(body.error ?? "解析失败");
    setPreview(body);
  }

  async function commitPreview() {
    setBusy(true);
    const res = await fetch("/api/imports/commit", { method: "POST", headers: { "content-type": "application/json", "x-role": role, "x-actor": "演示用户" }, body: JSON.stringify(preview) });
    const body = await res.json(); setBusy(false);
    if (!res.ok) return setNotice(body.error ?? "提交失败");
    setNotice(body.duplicate ? "该文件已导入，本次没有重复写入。" : "导入已提交，经营报表已重新计算。");
    await refresh();
  }

  async function previewMarginFile(file: File) {
    setBusy(true); setNotice("");
    const form = new FormData(); form.append("file", file); form.append("period", period);
    const res = await fetch("/api/product-margins/import/preview", { method: "POST", body: form });
    const body = await res.json(); setBusy(false);
    if (!res.ok) return setNotice(body.error ?? "毛利文件解析失败");
    setMarginPreview(body);
  }

  async function commitMarginFile() {
    setBusy(true);
    const res = await fetch("/api/product-margins/import/commit", { method: "POST", headers: { "content-type": "application/json", "x-role": role, "x-actor": "演示用户" }, body: JSON.stringify(marginPreview) });
    const body = await res.json(); setBusy(false);
    if (!res.ok) return setNotice(body.error ?? "毛利文件提交失败");
    setNotice(body.duplicate ? "该毛利文件已导入，本次未重复写入。" : `已导入 ${marginPreview.rows.length} 条单品毛利、${marginPreview.counterparties.length} 条资金往来。`);
    await refresh();
  }

  async function submitProductMargin(formData: FormData) {
    setBusy(true); setNotice("");
    const money = (name: string) => Math.round(Number(formData.get(name) || 0) * 100);
    const input = { period, category: String(formData.get("category")), productName: String(formData.get("productName")), uom: String(formData.get("uom")), sellingPriceCents: money("sellingPrice"), purchasePriceCents: money("purchasePrice"), auxiliaryCostCents: money("auxiliaryCost"), portionQty: Number(formData.get("portionQty") || 1), yieldRate: Number(formData.get("yieldRate") || 1), freightCents: money("freight"), note: String(formData.get("note") || "") };
    const res = await fetch("/api/product-margins", { method: "POST", headers: { "content-type": "application/json", "x-role": role, "x-actor": "演示用户" }, body: JSON.stringify(input) });
    const body = await res.json(); setBusy(false);
    if (!res.ok) return setNotice(body.error ?? "毛利录入失败");
    setNotice(`${input.productName} 已保存：每份成本 ${yuan(body.costCents)}，毛利率 ${pct(body.grossMargin)}。`); await refresh();
  }

  async function submitCounterparty(formData: FormData) {
    setBusy(true); setNotice("");
    const id = String(formData.get("id") || "");
    const common = { period, partyKind: String(formData.get("partyKind")), name: String(formData.get("name")), originalCents: Math.round(Number(formData.get("originalAmount")) * 100), settledCents: Math.round(Number(formData.get("settledAmount") || 0) * 100), dueDate: String(formData.get("dueDate") || ""), note: String(formData.get("note") || "") };
    const res = await fetch("/api/finance", { method: id ? "PATCH" : "POST", headers: { "content-type": "application/json", "x-role": role, "x-actor": "演示用户" }, body: JSON.stringify(id ? { id, ...common } : { kind: "counterparty", ...common }) });
    const body = await res.json(); setBusy(false);
    if (!res.ok) return setNotice(body.error ?? "资金往来保存失败");
    setEditingParty(null); setNotice(`资金往来已保存，状态：${body.status === "settled" ? "已结" : "未结"}。`); await refresh();
  }

  async function settleParty(party: DashboardData["parties"][number]) {
    const amountCents = party.originalCents - party.settledCents;
    if (amountCents <= 0) return;
    setBusy(true); setNotice("");
    const res = await fetch("/api/finance", { method: "POST", headers: { "content-type": "application/json", "x-role": role, "x-actor": "演示用户" }, body: JSON.stringify({ kind: "settlement", counterpartyId: party.id, amountCents }) });
    const body = await res.json(); setBusy(false);
    if (!res.ok) return setNotice(body.error ?? "结清失败");
    setNotice(`${party.name} 已结清。`); await refresh();
  }

  async function submitBank(formData: FormData) {
    setBusy(true); setNotice("");
    const input = { kind: "bank", businessDate: String(formData.get("businessDate")), summary: String(formData.get("summary")), incomeCents: Math.round(Number(formData.get("income") || 0) * 100), expenseCents: Math.round(Number(formData.get("expense") || 0) * 100), adjustment: false };
    const res = await fetch("/api/finance", { method: "POST", headers: { "content-type": "application/json", "x-role": role, "x-actor": "演示用户" }, body: JSON.stringify(input) });
    const body = await res.json(); setBusy(false);
    if (!res.ok) return setNotice(body.error ?? "银行流水保存失败");
    setNotice(`银行流水已保存，最新余额 ${yuan(body.balanceCents)}。`); await refresh();
  }

  async function submitStock(formData: FormData) {
    setBusy(true); setNotice("");
    const cost = String(formData.get("unitCost") ?? "").trim();
    const event = {
      itemId: String(formData.get("itemId")), warehouseId: String(formData.get("warehouseId")), eventType: String(formData.get("eventType")),
      businessDate: String(formData.get("businessDate")), quantity: Number(formData.get("quantity")), quantityUom: String(formData.get("quantityUom")), unitCostCents: cost ? Math.round(Number(cost) * 100) : undefined, note: String(formData.get("note") || ""),
    };
    const res = await fetch("/api/stock", { method: "POST", headers: { "content-type": "application/json", "x-role": role, "x-actor": "演示用户" }, body: JSON.stringify(event) });
    const body = await res.json(); setBusy(false);
    if (!res.ok) return setNotice(body.error ?? "库存写入失败");
    setNotice(`库存流水已记账：折合 ${number(body.stockQuantity)} ${body.stockUom}，计价成本 ${yuan(body.averageCostCents)}/${body.stockUom}。`); await refresh();
  }

  async function submitItem(formData: FormData) {
    setBusy(true); setNotice("");
    const item = {
      sku: String(formData.get("sku")), name: String(formData.get("name")), category: String(formData.get("category")),
      purchaseUom: String(formData.get("purchaseUom")), stockUom: String(formData.get("stockUom")), unitsPerPurchase: Number(formData.get("unitsPerPurchase")),
      unitNetContent: Number(formData.get("unitNetContent")), contentUom: String(formData.get("contentUom")), purchasePriceCents: Math.round(Number(formData.get("purchasePrice")) * 100), minimumQty: Number(formData.get("minimumQty")),
    };
    const res = await fetch("/api/master-data", { method: "POST", headers: { "content-type": "application/json", "x-role": role, "x-actor": "演示用户" }, body: JSON.stringify(item) });
    const body = await res.json(); setBusy(false);
    if (!res.ok) return setNotice(body.error ?? "商品建档失败");
    setStockItemId(body.id);
    setNotice(`商品 ${item.name} 已建档：1${item.purchaseUom} = ${number(item.unitsPerPurchase)}${item.stockUom}，每${item.stockUom}${number(item.unitNetContent)}${item.contentUom}。`);
    await refresh();
  }

  async function doClose() {
    if (!confirm(`确认锁定 ${periodLabel(period)}？锁定后普通业务单据不可修改。`)) return;
    setBusy(true);
    const res = await fetch("/api/period-close", { method: "POST", headers: { "content-type": "application/json", "x-role": role, "x-actor": "演示用户" }, body: JSON.stringify({ period }) });
    const body = await res.json(); setBusy(false);
    if (!res.ok) return setNotice(body.error ?? "月结失败");
    setNotice(`${periodLabel(period)}已锁定，后续修正必须走调整单。`); await refresh();
  }

  const sectionTitle = nav.find((x) => x.id === section)!;
  return <div className="app-shell">
    <header className="system-bar">
      <div className="system-brand"><div className="brand-seal">萍</div><strong>{session.stores.find((x) => x.id === session.storeId)?.name ?? "门店"}经营进销存管理系统</strong></div>
      <div className="system-actions">
        <label className="store-switch"><span>当前门店</span><select aria-label="选择门店" value={session.storeId} onChange={(e) => changeStore(e.target.value)}>{session.stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}</select></label>
        {session.role === "owner" && <><button className="text-button" onClick={addStore}>+ 新增门店</button><button className="text-button" onClick={() => setMemberOpen(true)}>+ 新建成员</button></>}
        <label className="period"><CalendarDays size={15}/><select aria-label="选择账期" value={period} onChange={(e)=>changePeriod(e.target.value)} disabled={busy}>{availablePeriods.map((item)=><option value={item} key={item}>{periodLabel(item)}</option>)}</select></label>
        <button className="warning-pill" onClick={() => { setSection("stock"); setStockWarningOnly(true); }}><TrendingDown size={16}/>库存预警 <b>{lowStock.length} 项</b></button>
      </div>
      {memberOpen && <div className="member-modal-backdrop" onClick={() => !busy && setMemberOpen(false)}><section className="member-modal" onClick={(event) => event.stopPropagation()}><div className="panel-head"><div><span>成员管理</span><h3>新建店长、财务或库管账号</h3></div><button className="text-button" onClick={() => setMemberOpen(false)}>关闭</button></div><form onSubmit={(event) => { event.preventDefault(); void submitMember(); }}><label>登录账号<input required value={memberForm.username} onChange={(event) => setMemberForm({ ...memberForm, username: event.target.value })} placeholder="如：finance.demo" /></label><label>成员姓名<input required value={memberForm.displayName} onChange={(event) => setMemberForm({ ...memberForm, displayName: event.target.value })} placeholder="如：李会计" /></label><label>初始密码<input required minLength={8} type="password" value={memberForm.password} onChange={(event) => setMemberForm({ ...memberForm, password: event.target.value })} placeholder="至少 8 位" /></label><label>角色<select value={memberForm.role} onChange={(event) => setMemberForm({ ...memberForm, role: event.target.value })}><option value="manager">店长</option><option value="finance">财务</option><option value="storekeeper">库管</option></select></label><button className="primary" disabled={busy} type="submit">{busy ? "创建中…" : "创建成员账号"}</button></form></section></div>}
    </header>
    <div className="app-frame">
    <aside className="sidebar">
      <nav>
        <span className="nav-group">财务报表</span>
        {nav.filter((item) => ["overview","gross","funds","close"].includes(item.id)).map((item) => { const Icon = item.icon; return <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => { setSection(item.id); setNotice(""); }}><Icon size={16}/><span><b>{item.label}</b><small>{item.hint}</small></span><ChevronRight size={14}/></button>; })}
        <span className="nav-group nav-group-second">进销存库存</span>
        {nav.filter((item) => ["stock","import"].includes(item.id)).map((item) => { const Icon = item.icon; return <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => { setSection(item.id); setNotice(""); }}><Icon size={16}/><span><b>{item.label}</b><small>{item.hint}</small></span><ChevronRight size={14}/></button>; })}
      </nav>
      <div className="sidebar-foot"><ShieldCheck size={17}/><span>本地数据<br/><small>Excel 不外传</small></span></div>
    </aside>
    <main>
      <header className="topbar">
        <div><span className="eyebrow">{session.stores.find((x) => x.id === session.storeId)?.name} / {sectionTitle.hint}</span><h1>{sectionTitle.label}</h1></div>
        <div className="top-actions"><label><UsersRound size={16}/><span>{session.displayName} · {role === "owner" ? "老板" : role === "finance" ? "财务" : role === "storekeeper" ? "库管" : "店长"}</span></label><button className="text-button" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.reload(); }}>退出</button></div>
      </header>

      <div className="close-rail"><div className="rail-title"><span className={closed ? "closed-dot" : "open-dot"}/><b>{closed ? "本月已锁定" : "本月待月结"}</b><small>{closed ? "仅允许调整单" : "5 项已核对，1 项待确认"}</small></div>{["收入归集","库存盘点","档口毛利","资金核对","往来确认","月结锁定"].map((x,i)=><div className={`rail-step ${i < (closed ? 6 : 5) ? "done" : "current"}`} key={x}><span>{i < (closed ? 6 : 5) ? <Check size={12}/> : i+1}</span>{x}</div>)}</div>
      {notice && <div className="notice"><ClipboardCheck size={17}/>{notice}<button onClick={()=>setNotice("")}>×</button></div>}

      <section className="content">
        {section === "overview" && <>
          <div className="statement"><div><span>{periodLabel(period)}经营结论</span><h2>本期营业额 <em>{yuan(data.sales?.grossRevenueCents)}</em>，综合毛利率 {pct(data.profit.grossMargin)}。</h2><p>{data.gross.length ? `营业利润为 ${yuan(data.profit.operatingProfitCents)}。系统已按档口成本、费用和优惠口径完成复算。` : "该历史月份目前只有营业收入数据，档口成本与费用明细等待后续导入。"}</p></div><div className="stamp">{data.profit.operatingProfitCents >= 0 ? <>稳<br/>健</> : <>待<br/>改善</>}</div></div>
          <div className="metric-grid">
            <Metric label="营业额（折前）" value={yuan(data.sales?.grossRevenueCents)} helper={periodLabel(period)} tone="green"/>
            <Metric label="实收营业收入" value={yuan(data.sales?.netRevenueCents)} helper={`优惠 ${yuan(data.sales?.discountCents)}`}/>
            <Metric label="销售成本" value={yuan(data.totalCogs)} helper={`成本率 ${pct(data.sales?.grossRevenueCents ? data.totalCogs / data.sales.grossRevenueCents : 0)}`}/>
            <Metric label="营业利润" value={yuan(data.profit.operatingProfitCents)} helper={`利润率 ${pct(data.profit.operatingMargin)}`} tone="red"/>
          </div>
          <div className="two-col">
            <article className="panel"><div className="panel-head"><div><span>01 / 半年走势</span><h3>营业额在六月明显抬升</h3></div><TrendingUp size={21}/></div><Trend data={data.trends}/></article>
            <article className="panel expense-panel"><div className="panel-head"><div><span>02 / 费用压力</span><h3>营销成本吞噬 46% 毛利</h3></div><ReceiptText size={21}/></div><div className="expense-list">{data.expenses.map((x)=><div key={x.id}><div><b>{x.category}</b><span>{yuan(x.amountCents)}</span></div><i style={{width:`${Math.max(4,x.amountCents/Math.max(...data.expenses.map(e=>e.amountCents))*100)}%`}}/></div>)}</div></article>
          </div>
          <article className="panel"><div className="panel-head"><div><span>03 / 档口表现</span><h3>折后毛利与折前毛利要分开看</h3></div><button className="text-button" onClick={()=>setSection("gross")}>查看完整毛利表 <ChevronRight size={15}/></button></div><GrossTable rows={data.gross.slice(0,5)} max={maxBooth}/></article>
        </>}

        {section === "gross" && <>
          <div className="metric-grid compact"><Metric label="综合毛利" value={yuan(data.profit.grossProfitCents)} helper={pct(data.profit.grossMargin)} tone="green"/><Metric label="单品毛利档案" value={`${data.productMargins.length} 项`} helper={`${new Set(data.productMargins.map(x=>x.category)).size} 个分类`}/><Metric label="优惠与折让" value={yuan(data.sales?.discountCents)} helper="折前与实收分开核算" tone="red"/><Metric label="销售成本" value={yuan(data.totalCogs)} helper="期初 + 净领料 − 期末"/></div>
          <article className="panel"><div className="panel-head"><div><span>实际成本法</span><h3>档口毛利复算</h3></div><span className="formula">期初 + 入库 − 出库 − 期末 = 销售成本</span></div><GrossTable rows={data.gross} max={maxBooth}/></article>
          <article className="panel product-margin-panel"><div className="panel-head"><div><span>理论成本法</span><h3>单品毛利明细</h3></div><span className="formula">(售价 − 每份成本) ÷ 售价 = 毛利率</span></div><ProductMarginTable rows={data.productMargins}/></article>
          <article className="panel item-master"><div className="panel-head"><div><span>自行录入</span><h3>新增或更新单品毛利</h3></div><small className="muted-copy">同账期、同分类、同品名会自动更新</small></div><form className="master-form margin-form" action={submitProductMargin}><label>分类<input name="category" placeholder="如 荤菜类" required/></label><label>品名<input name="productName" placeholder="如 鲜椒牛肉" required/></label><label>单位<input name="uom" defaultValue="份" required/></label><label>售价/份（元）<input name="sellingPrice" type="number" min="0.01" step="0.01" required/></label><label>进价（元）<input name="purchasePrice" type="number" min="0" step="0.01" required/></label><label>辅料（元）<input name="auxiliaryCost" type="number" min="0" step="0.01" defaultValue="0"/></label><label>出品分量<input name="portionQty" type="number" min="0.001" step="0.001" defaultValue="1" required/></label><label>净料率<input name="yieldRate" type="number" min="0.001" step="0.001" defaultValue="1" required/></label><label>每份运费（元）<input name="freight" type="number" min="0" step="0.01" defaultValue="0"/></label><label>备注<input name="note" placeholder="口径或异常说明"/></label><button className="primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<CircleDollarSign size={17}/>}计算并保存</button></form></article>
          <div className="insight-callout"><TrendingDown size={24}/><div><b>甜品档需要单独复核</b><p>折前收入较高，但实收与折前差异异常大。系统保留折前、实收和优惠三套口径，避免高毛利表象掩盖真实亏损。</p></div></div>
        </>}

        {section === "stock" && <>
          <div className="metric-grid compact"><Metric label="库存项目" value={`${data.stock.length} 项`} helper={`${data.items.length} 个商品档案`}/><Metric label="库存金额" value={yuan(data.stock.reduce((s,x)=>s+x.value_cents,0))} helper="移动加权计价"/><button className={`metric metric-action ${lowStock.length ? "metric-red" : "metric-green"}`} onClick={()=>{setStockWarningOnly(!stockWarningOnly);setStockSearch("");}}><span>低库存预警</span><strong>{lowStock.length} 项</strong><small>{stockWarningOnly ? "点击查看全部商品" : "点击查看具体商品"}</small></button><Metric label="库存流水" value="不可覆盖" helper="修正需新增调整单"/></div>
          <div className="stock-layout"><article className="panel stock-table"><div className="panel-head"><div><span>{stockWarningOnly ? "仅看预警" : "实时台账"}</span><h3>{stockWarningOnly ? `需要补货的 ${lowStock.length} 个商品` : "库存余额与平均成本"}</h3></div><div className="table-actions">{stockWarningOnly&&<button className="text-button" onClick={()=>setStockWarningOnly(false)}>查看全部</button>}<label className="search"><Search size={15}/><input aria-label="搜索商品或SKU" value={stockSearch} onChange={(e)=>setStockSearch(e.target.value)} placeholder="商品 / SKU"/></label></div></div><table><thead><tr><th>商品</th><th>仓库</th><th>结存</th><th>平均成本</th><th>库存金额</th><th>状态</th></tr></thead><tbody>{filteredStock.map((x)=><tr className={x.quantity < x.minimumQty ? "warning-row" : ""} key={`${x.item_id}-${x.warehouse_id}`}><td><b>{x.itemName}</b><small>{x.sku} · {x.category}</small><small>1{x.purchaseUom} = {number(x.unitsPerPurchase)}{x.uom}；每{x.uom}{number(x.unitNetContent)}{x.contentUom}</small></td><td>{x.warehouseName}</td><td>{number(x.quantity)} {x.uom}</td><td>{yuan(x.averageCostCents)}/{x.uom}</td><td>{yuan(x.value_cents)}</td><td><span className={x.quantity < x.minimumQty ? "tag danger" : "tag ok"}>{x.quantity < x.minimumQty ? "预警" : "正常"}</span></td></tr>)}{!filteredStock.length&&<tr><td colSpan={6} className="empty-row">没有找到匹配的商品或 SKU</td></tr>}</tbody></table></article>
          <article className="panel quick-form"><div className="panel-head"><div><span>新增流水</span><h3>记录库存作业</h3></div><PackagePlus size={20}/></div><form action={submitStock}><label>业务类型<select name="eventType"><option value="purchase">采购入库</option><option value="issue">档口领料</option><option value="issue_return">档口退料</option><option value="return">采购退货</option><option value="waste">报损</option><option value="adjustment">盘点调整</option></select></label><label>商品<select name="itemId" value={stockItemId} onChange={(e)=>{setStockItemId(e.target.value);setQuantityUom("purchase");}}>{data.items.map(x=><option value={x.id} key={x.id}>{x.name}（{x.sku}）</option>)}</select></label>{selectedItem&&<div className="spec-preview"><b>包装换算</b><span>1{selectedItem.purchaseUom} = {number(selectedItem.unitsPerPurchase)}{selectedItem.stockUom} · 每{selectedItem.stockUom}{number(selectedItem.unitNetContent)}{selectedItem.contentUom}</span></div>}<label>仓库<select name="warehouseId">{data.warehouses.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><div className="form-row"><label>数量<input name="quantity" type="number" min="0.001" step="0.001" required/></label><label>录入单位<select name="quantityUom" value={quantityUom} onChange={(e)=>setQuantityUom(e.target.value as "purchase"|"stock")}><option value="purchase">{selectedItem?.purchaseUom ?? "采购单位"}</option><option value="stock">{selectedItem?.stockUom ?? "最小单位"}</option></select></label></div><label>{quantityUom === "purchase" ? `每${selectedItem?.purchaseUom ?? "采购单位"}价格` : `每${selectedItem?.stockUom ?? "最小单位"}成本`}<input name="unitCost" type="number" min="0" step="0.01" placeholder={quantityUom === "purchase" ? "采购入库可用商品默认价格" : "入库时填写"}/></label><label>业务日期<input name="businessDate" type="date" defaultValue="2026-07-11" required/></label><label>备注<input name="note" placeholder="单据号或原因"/></label><button className="primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<ArchiveRestore size={17}/>}记入不可变流水</button></form></article></div>
          <article className="panel item-master"><div className="panel-head"><div><span>商品档案</span><h3>新增商品与包装规格</h3></div><span className="formula">示例：1箱 = 10袋，每袋1kg</span></div><form className="master-form" action={submitItem}><label>商品 SKU<input name="sku" placeholder="如 YL-007" required/></label><label>商品名称<input name="name" placeholder="如 火锅底料" required/></label><label>商品分类<input name="category" placeholder="如 锅底" required/></label><label>整件采购价（元）<input name="purchasePrice" type="number" min="0" step="0.01" placeholder="如 100" required/></label><label>采购单位<input name="purchaseUom" placeholder="箱" required/></label><label>每件含最小单位数<input name="unitsPerPurchase" type="number" min="0.001" step="0.001" placeholder="10" required/></label><label>最小出库单位<input name="stockUom" placeholder="袋" required/></label><label>每最小单位净含量<input name="unitNetContent" type="number" min="0.001" step="0.001" placeholder="1" required/></label><label>净含量单位<input name="contentUom" placeholder="kg" required/></label><label>安全库存（最小单位）<input name="minimumQty" type="number" min="0" step="0.001" placeholder="20" required/></label><button className="primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<PackagePlus size={17}/>}保存商品档案</button></form></article>
        </>}

        {section === "import" && <>
          <div className="import-hero"><div className="upload-icon"><FileSpreadsheet size={30}/></div><div><span>Excel 导入中心</span><h2>先预览、再核对、最后入账</h2><p>原始文件保持只读。系统识别 8 张工作表，并自动跳过低值易耗表的异常空白区域。</p></div><input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e)=>e.target.files?.[0]&&previewFile(e.target.files[0])}/><button className="primary" onClick={()=>fileRef.current?.click()} disabled={busy}>{busy?<LoaderCircle className="spin" size={18}/>:<Upload size={18}/>}选择经营报表</button></div>
          {!preview ? <div className="empty-import"><ArrowDownToLine size={38}/><b>等待选择 .xlsx 文件</b><span>推荐使用“虚构经营报表.xlsx”验证</span></div> : <>
            <div className="file-ticket"><div><FileSpreadsheet size={22}/><span><b>{preview.fileName}</b><small>SHA-256 {preview.fileHash.slice(0,16)}…</small></span></div><span className={`tag ${preview.duplicate?'warn':'ok'}`}>{preview.duplicate?'已导入':'可提交'}</span></div>
            <div className="metric-grid compact"><Metric label="识别工作表" value={`${preview.sheets.filter((x:any)=>x.status==='recognized').length} / ${preview.sheets.length}`} helper="目录与业务表"/><Metric label="营业额" value={`¥${number(preview.summary.grossRevenue)}`} helper={`实收 ¥${number(preview.summary.netRevenue)}`}/><Metric label="销售成本" value={`¥${number(preview.summary.cogs)}`} helper={`毛利 ¥${number(preview.summary.grossProfit)}`}/><Metric label="校验问题" value={`${preview.errors.length} 项`} helper={`${preview.warnings.length} 条提示`} tone={preview.errors.length?'red':'green'}/></div>
            <div className="two-col import-grid"><article className="panel"><div className="panel-head"><div><span>工作表识别</span><h3>读取范围</h3></div></div><div className="sheet-list">{preview.sheets.map((x:any)=><div key={x.name}><span className={x.status==='recognized'?'sheet-ok':'sheet-ignore'}>{x.status==='recognized'?<Check size={13}/>:"—"}</span><b>{x.name}</b><small>{x.detectedRows} 个有效行</small></div>)}</div></article><article className="panel"><div className="panel-head"><div><span>对账提示</span><h3>提交前检查</h3></div></div><div className="warning-list">{[...preview.errors,...preview.warnings].map((x:string,i:number)=><p key={i} className={i<preview.errors.length?'error-text':''}><span>{i+1}</span>{x}</p>)}{!preview.errors.length&&!preview.warnings.length&&<p><Check size={15}/>没有发现口径差异</p>}</div><button className="primary full" onClick={commitPreview} disabled={busy||preview.errors.length}>{busy?<LoaderCircle className="spin" size={17}/>:<ClipboardCheck size={17}/>}确认导入并重新计算</button></article></div>
          </>}
          <div className="import-hero secondary-import"><div className="upload-icon"><ReceiptText size={30}/></div><div><span>Word / 单品毛利导入</span><h2>导入单品毛利、资金往来和银行流水</h2><p>支持 .docx 表格和你提供的菜品毛利 .xlsx 模板。所有金额先按系统公式复算并显示异常提示。</p></div><input ref={marginFileRef} type="file" accept=".docx,.xlsx" hidden onChange={(e)=>e.target.files?.[0]&&previewMarginFile(e.target.files[0])}/><button className="primary" onClick={()=>marginFileRef.current?.click()} disabled={busy}>{busy?<LoaderCircle className="spin" size={18}/>:<Upload size={18}/>}选择 Word / 毛利表</button></div>
          {marginPreview&&<><div className="file-ticket"><div><ReceiptText size={22}/><span><b>{marginPreview.fileName}</b><small>{marginPreview.sourceType === "word" ? "Word 结构化表格" : "Excel 单品毛利模板"}</small></span></div><span className={`tag ${marginPreview.errors.length?'danger':marginPreview.duplicate?'warn':'ok'}`}>{marginPreview.errors.length?'有错误':marginPreview.duplicate?'已导入':'可提交'}</span></div><div className="metric-grid compact"><Metric label="单品毛利" value={`${marginPreview.rows.length} 项`} helper={`${new Set(marginPreview.rows.map((x:any)=>x.category)).size} 个分类`}/><Metric label="资金往来" value={`${marginPreview.counterparties.length} 条`} helper="含已结 / 未结状态"/><Metric label="银行流水" value={`${marginPreview.bankRows.length} 条`} helper="按日期连续入账"/><Metric label="复核提示" value={`${marginPreview.warnings.length} 条`} helper={`${marginPreview.errors.length} 个错误`} tone={marginPreview.errors.length?'red':'green'}/></div><article className="panel"><div className="panel-head"><div><span>公式复算</span><h3>导入前复核</h3></div></div><div className="warning-list preview-scroll">{[...marginPreview.errors,...marginPreview.warnings].map((x:string,i:number)=><p key={i} className={i<marginPreview.errors.length?'error-text':''}><span>{i+1}</span>{x}</p>)}{!marginPreview.errors.length&&!marginPreview.warnings.length&&<p><Check size={15}/>文件结构和公式校验通过</p>}</div><button className="primary full" onClick={commitMarginFile} disabled={busy||marginPreview.errors.length}>{busy?<LoaderCircle className="spin" size={17}/>:<ClipboardCheck size={17}/>}确认导入单品毛利与资金数据</button></article></>}
          <DirectEntryPanel period={period} boothNames={data.gross.map((item) => item.boothName)} onCommitted={refresh}/>
        </>}

        {section === "funds" && <>
          <div className="metric-grid compact"><Metric label="银行余额" value={yuan(data.bank?.balanceCents)} helper={`截至 ${periodLabel(period)}末`} tone="green"/><Metric label="应收余额" value={yuan(receivable)} helper={`${data.parties.filter(x=>x.kind==='receivable'&&x.status!=='settled').length} 笔未结`}/><Metric label="应付余额" value={yuan(payable)} helper={`${data.parties.filter(x=>x.kind==='payable'&&x.status!=='settled').length} 笔未结`} tone="red"/><Metric label="净资金敞口" value={yuan((data.bank?.balanceCents??0)+receivable-payable)} helper="银行 + 应收 − 应付"/></div>
          <div className="two-col"><article className="panel"><div className="panel-head"><div><span>应付账款</span><h3>供应商账期</h3></div><Warehouse size={21}/></div><PartyTable rows={data.parties.filter(x=>x.kind==='payable')} onEdit={setEditingParty} onSettle={settleParty}/></article><article className="panel"><div className="panel-head"><div><span>应收账款</span><h3>平台与渠道待结</h3></div><Banknote size={21}/></div><PartyTable rows={data.parties.filter(x=>x.kind==='receivable')} onEdit={setEditingParty} onSettle={settleParty}/></article></div>
          <div className="two-col finance-forms"><article className="panel quick-form"><div className="panel-head"><div><span>{editingParty ? "编辑往来" : "自行录入"}</span><h3>{editingParty ? editingParty.name : "新增应收 / 应付"}</h3></div>{editingParty&&<button className="text-button" onClick={()=>setEditingParty(null)}>取消编辑</button>}</div><form key={editingParty?.id ?? "new-party"} action={submitCounterparty}><input type="hidden" name="id" value={editingParty?.id ?? ""}/><label>往来类型<select name="partyKind" defaultValue={editingParty?.kind ?? "payable"}><option value="payable">应付</option><option value="receivable">应收</option></select></label><label>往来对象<input name="name" defaultValue={editingParty?.name ?? ""} placeholder="供应商或渠道" required/></label><div className="form-row"><label>原始金额<input name="originalAmount" type="number" min="0.01" step="0.01" defaultValue={editingParty ? editingParty.originalCents/100 : ""} required/></label><label>已结金额<input name="settledAmount" type="number" min="0" step="0.01" defaultValue={editingParty ? editingParty.settledCents/100 : 0}/></label></div><label>到期日<input name="dueDate" type="date" defaultValue={editingParty?.dueDate ?? `${period}-28`}/></label><label>备注<input name="note" defaultValue={editingParty?.note ?? ""} placeholder="账期或付款说明"/></label><button className="primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<ClipboardCheck size={17}/>}保存资金往来</button></form></article><article className="panel quick-form"><div className="panel-head"><div><span>银行流水</span><h3>新增收入 / 支出</h3></div><Banknote size={21}/></div><form key={`bank-${period}`} action={submitBank}><label>业务日期<input name="businessDate" type="date" defaultValue={`${period}-28`} required/></label><label>摘要<input name="summary" placeholder="如 供应商付款" required/></label><div className="form-row"><label>收入金额<input name="income" type="number" min="0" step="0.01" defaultValue="0"/></label><label>支出金额<input name="expense" type="number" min="0" step="0.01" defaultValue="0"/></label></div><div className="spec-preview"><b>不可直接覆盖</b><span>银行流水通过新增记录修正，系统会自动计算连续余额并保留审计。</span></div><button className="primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<Banknote size={17}/>}保存银行流水</button></form></article></div>
        </>}

        {section === "close" && <>
          <div className="close-card"><div className="close-lock"><LockKeyhole size={32}/></div><div><span>{periodLabel(period)}</span><h2>{closed ? "账期已锁定" : "距离完成月结只差最后确认"}</h2><p>{closed ? "普通库存与财务单据已禁止回写历史月份；如需修正，请建立带原因的调整单。" : "系统已完成收入、成本、库存、银行和往来复核。锁定后将保留本月数据快照。"}</p></div><button className="primary" onClick={doClose} disabled={busy||closed}>{closed?<><Check size={18}/>已完成月结</>:<><LockKeyhole size={18}/>确认锁定本月</>}</button></div>
          <div className="reconcile-grid">{[
            ["营业额与档口汇总", yuan(data.sales?.grossRevenueCents), "一致", true], ["销售成本与档口成本", yuan(data.totalCogs), "一致", true], ["档口期末库存", yuan(data.gross.reduce((s,x)=>s+x.closingCents,0)), "已盘点", true], ["招商银行期末余额", yuan(data.bank?.balanceCents), "一致", true], ["应收 / 应付余额", `${yuan(receivable)} / ${yuan(payable)}`, "已确认", true], ["营业利润", yuan(data.profit.operatingProfitCents), "需改善", false]
          ].map(([title,value,status,ok])=><article key={String(title)}><div className={ok?"check-ring":"warn-ring"}>{ok?<Check size={17}/>:<TrendingDown size={17}/>}</div><span>{title}</span><b>{value}</b><small>{status}</small></article>)}</div>
          <article className="panel audit-note"><ShieldCheck size={24}/><div><b>月结不是覆盖数据</b><p>所有业务流水保持原样。锁定后的修正会新增“调整”事件，并记录操作者、原因和时间，保证每一笔差异可追溯。</p></div></article>
        </>}
      </section>
    </main>
    </div>
  </div>;
}

type DirectExpense = { category: string; amount: string; note: string };
type DirectBooth = { name: string; gross: string; net: string; opening: string; inbound: string; outbound: string; closing: string; adjustment: string };
type DirectBank = { businessDate: string; summary: string; income: string; expense: string };
type DirectParty = { kind: "receivable" | "payable"; name: string; original: string; settled: string; dueDate: string; note: string };
type DirectPreview = { revenueCents: number; cogsCents: number; grossProfitCents: number; expenseCents: number; profitCents: number; bankBalanceCents: number; receivableCents: number; payableCents: number; errors: string[]; warnings: string[] };

const cents = (value: string) => Math.round((Number(value) || 0) * 100);
const moneyInput = (centsValue: number) => (centsValue / 100).toFixed(2);
const emptyExpense = (): DirectExpense => ({ category: "", amount: "", note: "" });
const emptyBank = (period: string): DirectBank => ({ businessDate: `${period}-01`, summary: "", income: "", expense: "" });
const emptyParty = (period: string): DirectParty => ({ kind: "receivable", name: "", original: "", settled: "0", dueDate: `${period}-28`, note: "" });

function DirectEntryPanel({ period, boothNames, onCommitted }: { period: string; boothNames: string[]; onCommitted: () => Promise<void> }) {
  const [sales, setSales] = useState({ gross: "", net: "", discount: "0", orders: "0" });
  const [expenses, setExpenses] = useState<DirectExpense[]>([emptyExpense()]);
  const [booths, setBooths] = useState<DirectBooth[]>(() => boothNames.map((name) => ({ name, gross: "", net: "", opening: "0", inbound: "0", outbound: "0", closing: "0", adjustment: "0" })));
  const [bankRows, setBankRows] = useState<DirectBank[]>([emptyBank(period)]);
  const [parties, setParties] = useState<DirectParty[]>([emptyParty(period)]);
  const [preview, setPreview] = useState<DirectPreview | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const boothRevenue = booths.reduce((sum, row) => sum + cents(row.gross), 0);
  const updateRow = <T,>(rows: T[], index: number, patch: Partial<T>, setter: (value: T[]) => void) => setter(rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  const createPayload = () => ({
    period,
    sales: { grossRevenueCents: cents(sales.gross), netRevenueCents: cents(sales.net), discountCents: cents(sales.discount), orderCount: Math.max(0, Math.trunc(Number(sales.orders) || 0)) },
    expenses: expenses.filter((row) => row.category.trim() || row.amount.trim() || row.note.trim()).map((row) => ({ category: row.category, amountCents: cents(row.amount), note: row.note || undefined })),
    booths: booths.map((row) => ({
      name: row.name, grossRevenueCents: cents(row.gross), netRevenueCents: cents(row.net || row.gross), discountCents: 0,
      openingCents: cents(row.opening), inboundCents: cents(row.inbound), outboundCents: cents(row.outbound), closingCents: cents(row.closing), adjustmentCents: Math.round((Number(row.adjustment) || 0) * 100),
      cogsCents: cents(row.opening) + cents(row.inbound) - cents(row.outbound) - cents(row.closing) + Math.round((Number(row.adjustment) || 0) * 100),
    })),
    bankRows: bankRows.filter((row) => row.businessDate || row.summary || row.income || row.expense).map((row) => ({ businessDate: row.businessDate, summary: row.summary, incomeCents: cents(row.income), expenseCents: cents(row.expense) })),
    counterparties: parties.filter((row) => row.name.trim() || row.original.trim() || row.note.trim()).map((row) => ({ kind: row.kind, name: row.name, originalCents: cents(row.original), settledCents: cents(row.settled), dueDate: row.dueDate || undefined, note: row.note || undefined })),
  });

  async function requestPreview() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/direct-entry/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(createPayload()) });
      const body = await response.json();
      if (!response.ok) { setPreview(null); setMessage(body.error ?? "预览失败，请检查填写内容"); return; }
      setPreview(body);
      setMessage(body.errors.length ? "发现问题，请修正后再确认入账。" : "预览已更新，请核对金额与提示。");
    } catch { setMessage("预览请求失败，请检查网络后重试。"); }
    finally { setBusy(false); }
  }

  async function commit() {
    if (!preview || preview.errors.length) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/direct-entry/commit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(createPayload()) });
      const body = await response.json();
      if (!response.ok) { setMessage(body.error ?? "确认入账失败"); return; }
      setPreview(body); setMessage("已确认入账，经营报表已按本次直接录入重新计算。");
      await onCommitted();
    } catch { setMessage("确认入账失败，请稍后重试。"); }
    finally { setBusy(false); }
  }

  return <section className="direct-entry" aria-label="直接编辑录入">
    <div className="direct-entry-head"><div><span>直接编辑录入</span><h2>不准备文件，也可以逐项填写后统一入账</h2><p>先预览核对，再确认写入。系统会检查账期、营业额与档口汇总、以及是否会覆盖此前直接录入。</p></div><div className="direct-period"><CalendarDays size={16}/><b>{periodLabel(period)}</b><small>当前账期</small></div></div>
    <div className="direct-entry-grid">
      <article className="panel entry-card"><div className="panel-head"><div><span>01 · 营业收入</span><h3>本期汇总</h3></div><ReceiptText size={20}/></div><div className="entry-fields four"><label>营业额（元）<input type="number" min="0" step="0.01" value={sales.gross} onChange={(e) => setSales({ ...sales, gross: e.target.value })} placeholder="0.00"/></label><label>实收（元）<input type="number" min="0" step="0.01" value={sales.net} onChange={(e) => setSales({ ...sales, net: e.target.value })} placeholder="0.00"/></label><label>优惠（元）<input type="number" min="0" step="0.01" value={sales.discount} onChange={(e) => setSales({ ...sales, discount: e.target.value })}/></label><label>订单数<input type="number" min="0" step="1" value={sales.orders} onChange={(e) => setSales({ ...sales, orders: e.target.value })}/></label></div><p className={boothRevenue === cents(sales.gross) ? "entry-tip good" : "entry-tip"}>档口营业额合计：{yuan(boothRevenue)} {boothRevenue === cents(sales.gross) ? "· 已与营业额一致" : "· 需与营业额保持一致"}</p></article>
      <article className="panel entry-card"><div className="panel-head"><div><span>02 · 费用明细</span><h3>可逐行添加</h3></div><button className="text-button" onClick={() => setExpenses([...expenses, emptyExpense()])}><Plus size={14}/>新增一行</button></div><div className="entry-lines">{expenses.map((row, index) => <div className="entry-line expense" key={index}><input value={row.category} onChange={(e) => updateRow(expenses, index, { category: e.target.value }, setExpenses)} placeholder="费用科目，如房租"/><input type="number" min="0" step="0.01" value={row.amount} onChange={(e) => updateRow(expenses, index, { amount: e.target.value }, setExpenses)} placeholder="金额（元）"/><input value={row.note} onChange={(e) => updateRow(expenses, index, { note: e.target.value }, setExpenses)} placeholder="备注（可选）"/><button aria-label="删除费用行" className="line-remove" onClick={() => setExpenses(expenses.length === 1 ? [emptyExpense()] : expenses.filter((_, i) => i !== index))}><Trash2 size={14}/></button></div>)}</div></article>
    </div>
    <article className="panel entry-card entry-wide"><div className="panel-head"><div><span>03 · 档口毛利</span><h3>库存口径自动计算销售成本</h3></div><span className="formula">成本 = 期初 + 调入 − 调出 − 期末 + 调整</span></div><div className="entry-table-wrap"><table className="entry-table"><thead><tr><th>档口</th><th>营业额</th><th>实收</th><th>期初</th><th>调入/领料</th><th>调出/退料</th><th>期末</th><th>调整</th><th>自动成本</th></tr></thead><tbody>{booths.map((row, index) => { const cost = cents(row.opening) + cents(row.inbound) - cents(row.outbound) - cents(row.closing) + Math.round((Number(row.adjustment) || 0) * 100); return <tr key={row.name}><td><b>{row.name}</b></td>{(["gross", "net", "opening", "inbound", "outbound", "closing", "adjustment"] as const).map((field) => <td key={field}><input type="number" min={field === "adjustment" ? undefined : "0"} step="0.01" value={row[field]} onChange={(e) => updateRow(booths, index, { [field]: e.target.value }, setBooths)}/></td>)}<td className={cost < 0 ? "negative" : "positive"}>{yuan(cost)}</td></tr>; })}</tbody></table></div></article>
    <div className="direct-entry-grid funds-entry">
      <article className="panel entry-card"><div className="panel-head"><div><span>04 · 银行流水</span><h3>收入与支出</h3></div><button className="text-button" onClick={() => setBankRows([...bankRows, emptyBank(period)])}><Plus size={14}/>新增一行</button></div><div className="entry-lines">{bankRows.map((row, index) => <div className="entry-line bank" key={index}><input type="date" value={row.businessDate} onChange={(e) => updateRow(bankRows, index, { businessDate: e.target.value }, setBankRows)}/><input value={row.summary} onChange={(e) => updateRow(bankRows, index, { summary: e.target.value }, setBankRows)} placeholder="摘要"/><input type="number" min="0" step="0.01" value={row.income} onChange={(e) => updateRow(bankRows, index, { income: e.target.value }, setBankRows)} placeholder="收入"/><input type="number" min="0" step="0.01" value={row.expense} onChange={(e) => updateRow(bankRows, index, { expense: e.target.value }, setBankRows)} placeholder="支出"/><button aria-label="删除银行流水行" className="line-remove" onClick={() => setBankRows(bankRows.length === 1 ? [emptyBank(period)] : bankRows.filter((_, i) => i !== index))}><Trash2 size={14}/></button></div>)}</div></article>
      <article className="panel entry-card"><div className="panel-head"><div><span>05 · 应收 / 应付</span><h3>待结款项</h3></div><button className="text-button" onClick={() => setParties([...parties, emptyParty(period)])}><Plus size={14}/>新增一行</button></div><div className="entry-lines">{parties.map((row, index) => <div className="entry-line party" key={index}><select value={row.kind} onChange={(e) => updateRow(parties, index, { kind: e.target.value as DirectParty["kind"] }, setParties)}><option value="receivable">应收</option><option value="payable">应付</option></select><input value={row.name} onChange={(e) => updateRow(parties, index, { name: e.target.value }, setParties)} placeholder="单位 / 渠道"/><input type="number" min="0" step="0.01" value={row.original} onChange={(e) => updateRow(parties, index, { original: e.target.value }, setParties)} placeholder="原始金额"/><input type="number" min="0" step="0.01" value={row.settled} onChange={(e) => updateRow(parties, index, { settled: e.target.value }, setParties)} placeholder="已结金额"/><input type="date" value={row.dueDate} onChange={(e) => updateRow(parties, index, { dueDate: e.target.value }, setParties)}/><button aria-label="删除往来行" className="line-remove" onClick={() => setParties(parties.length === 1 ? [emptyParty(period)] : parties.filter((_, i) => i !== index))}><Trash2 size={14}/></button></div>)}</div></article>
    </div>
    <div className="entry-actions"><button className="primary" disabled={busy} onClick={requestPreview}>{busy ? <LoaderCircle className="spin" size={17}/> : <Eye size={17}/>}预览并核对</button><span>{message}</span></div>
    {preview && <article className="panel direct-preview"><div className="panel-head"><div><span>入账前预览</span><h3>{preview.errors.length ? "发现问题，暂不能确认入账" : "金额与账期核对"}</h3></div><span className={`tag ${preview.errors.length ? "danger" : "ok"}`}>{preview.errors.length ? `${preview.errors.length} 个错误` : "可确认"}</span></div><div className="metric-grid compact"><Metric label="营业收入" value={yuan(preview.revenueCents)} helper="本期营业额"/><Metric label="销售成本" value={yuan(preview.cogsCents)} helper="按档口库存公式"/><Metric label="毛利" value={yuan(preview.grossProfitCents)} helper="营业收入 − 销售成本" tone="green"/><Metric label="营业利润" value={yuan(preview.profitCents)} helper={`费用 ${yuan(preview.expenseCents)}`} tone={preview.profitCents < 0 ? "red" : "green"}/><Metric label="银行期末余额" value={yuan(preview.bankBalanceCents)} helper="按流水日期连续计算"/><Metric label="应收余额" value={yuan(preview.receivableCents)} helper="未结应收"/><Metric label="应付余额" value={yuan(preview.payableCents)} helper="未结应付"/></div><div className="entry-checks">{[...preview.errors, ...preview.warnings].map((item, index) => <p className={index < preview.errors.length ? "error-text" : ""} key={`${item}-${index}`}><span>{index + 1}</span>{item}</p>)}{!preview.errors.length && !preview.warnings.length && <p className="good"><Check size={15}/>未发现异常，可以确认入账。</p>}</div><button className="primary full" disabled={busy || preview.errors.length > 0} onClick={commit}>{busy ? <LoaderCircle className="spin" size={17}/> : <ClipboardCheck size={17}/>}确认入账</button></article>}
  </section>;
}

function GrossTable({ rows, max }: { rows: DashboardData["gross"]; max: number }) {
  return <div className="table-wrap"><table><thead><tr><th>档口</th><th>营业额</th><th>实收</th><th>销售成本</th><th>折前毛利</th><th>折前毛利率</th><th>规模</th></tr></thead><tbody>{rows.map((x)=><tr key={x.boothId}><td><b>{x.boothName}</b></td><td>{yuan(x.grossRevenueCents)}</td><td>{yuan(x.netRevenueCents)}</td><td>{yuan(x.cogsCents)}</td><td className={x.grossProfitCents<0?"negative":"positive"}>{yuan(x.grossProfitCents)}</td><td>{pct(x.grossRevenueCents?x.grossProfitCents/x.grossRevenueCents:0)}</td><td><div className="mini-bar"><i style={{width:`${max ? x.grossRevenueCents/max*100 : 0}%`}}/></div></td></tr>)}{!rows.length&&<tr><td colSpan={7} className="empty-row">该账期暂无档口毛利数据</td></tr>}</tbody></table></div>;
}

function ProductMarginTable({ rows }: { rows: DashboardData["productMargins"] }) {
  return <div className="table-wrap product-margin-table"><table><thead><tr><th>分类 / 品名</th><th>售价</th><th>进价</th><th>出品分量</th><th>净料率</th><th>每份成本</th><th>毛利</th><th>毛利率</th><th>来源</th></tr></thead><tbody>{rows.map((x)=><tr key={x.id} className={x.grossProfitCents<0?"warning-row":""}><td><b>{x.productName}</b><small>{x.category} · {x.uom}</small></td><td>{yuan(x.sellingPriceCents)}</td><td>{yuan(x.purchasePriceCents)}</td><td>{number(x.portionQty)}</td><td>{number(x.yieldRate)}</td><td>{yuan(x.costCents)}</td><td className={x.grossProfitCents<0?"negative":"positive"}>{yuan(x.grossProfitCents)}</td><td>{pct(x.grossMargin)}</td><td><span className={`tag ${x.sourceType === "manual" ? "warn" : "ok"}`}>{x.sourceType === "word" ? "Word" : x.sourceType === "excel" ? "Excel" : "手工"}</span></td></tr>)}{!rows.length&&<tr><td colSpan={9} className="empty-row">暂无单品毛利，可在下方自行录入或到“数据导入”选择 Word / Excel 毛利表</td></tr>}</tbody></table></div>;
}

function PartyTable({ rows, onEdit, onSettle }: { rows: DashboardData["parties"]; onEdit: (party: DashboardData["parties"][number]) => void; onSettle: (party: DashboardData["parties"][number]) => void }) {
  return <div className="party-list">{rows.map((x)=><div key={x.id}><span><b>{x.name}</b><small>到期 {x.dueDate || "未设置"} · 原始 {yuan(x.originalCents)}</small></span><strong>{yuan(x.originalCents-x.settledCents)}</strong><i className={`tag ${x.status === "settled" ? "ok" : "warn"}`}>{x.status === "settled" ? "已结" : "未结"}</i><span className="party-actions"><button onClick={()=>onEdit(x)}>编辑</button>{x.status!=="settled"&&<button onClick={()=>onSettle(x)}>结清</button>}</span></div>)}</div>;
}
