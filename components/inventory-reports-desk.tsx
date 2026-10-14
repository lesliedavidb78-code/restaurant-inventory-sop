"use client";
import { useEffect, useMemo, useState } from "react";
import { businessDate } from "@/lib/domain/business-date";
import { requestJson } from "@/lib/client/request-json";
import { OperationDialog } from "@/components/operation-dialog";
import { TablePager } from "@/components/table-pager";
import { pageSlice } from "@/lib/domain/inventory-ui";
const today = () => businessDate();
const unitPrice = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6, useGrouping: false });

export function InventoryReportsDesk({ warehouses }: { warehouses: { id: string; name: string }[] }) {
  const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false);
  const [period, setPeriod] = useState(today().slice(0, 7)); const [data, setData] = useState<any>(null); const [message, setMessage] = useState(""); const [selected, setSelected] = useState<Record<string, { qty: string; cost: string }>>({}); const [openingPage, setOpeningPage] = useState(1); const [issuePage, setIssuePage] = useState(1); const [trendPage, setTrendPage] = useState(1); const [marginPage, setMarginPage] = useState(1); const [pageSize, setPageSize] = useState(20);
  const refresh = async () => { setData(await requestJson(`/api/inventory-reports?period=${period}`)); };
  useEffect(() => { let active = true; void requestJson(`/api/inventory-reports?period=${period}`).then((result) => { if (active) setData(result); }).catch((e) => { if (active) setMessage(e.message); }); return () => { active=false; }; }, [period]);
  useEffect(() => { try { const raw=sessionStorage.getItem("opening-stock-draft"); if(raw) setSelected(JSON.parse(raw)); } catch {} setLoaded(true); }, []);
  useEffect(() => { if(loaded) sessionStorage.setItem("opening-stock-draft",JSON.stringify(selected)); }, [selected,loaded]);
  useEffect(() => { setOpeningPage(1); setIssuePage(1); setTrendPage(1); setMarginPage(1); }, [period, pageSize]);
  const opening = useMemo(() => pageSlice(data?.openingItems ?? [], openingPage, pageSize), [data, openingPage, pageSize]);
  const issues = useMemo(() => pageSlice(data?.issueSummary ?? [], issuePage, pageSize), [data, issuePage, pageSize]);
  const trends = useMemo(() => pageSlice(data?.costTrend ?? [], trendPage, pageSize), [data, trendPage, pageSize]);
  const margins = useMemo(() => pageSlice(data?.margins ?? [], marginPage, pageSize), [data, marginPage, pageSize]);
  if (!data) return <section className="card"><h2>库存报表</h2><p>{message || "正在读取…"}</p><button onClick={() => void refresh().catch(e => setMessage(e.message))}>重新读取</button></section>;
  const commit = async () => {
    if (busy) return;
    try { setBusy(true); const entered=Object.entries(selected).filter(([,v])=>v.qty?.trim());
      if(entered.some(([,v])=>!Number.isFinite(Number(v.qty)) || Number(v.qty)<0 || !Number.isFinite(Number(v.cost || 0)) || Number(v.cost || 0)<0)) throw new Error("期初数量或单价无效，请修正；输入已保留。");
      const lines=entered.filter(([,v])=>Number(v.qty)>0).map(([itemId,v])=>({itemId,quantity:Number(v.qty),quantityUom:"stock",unitCostCents:Number(v.cost || 0)*100}));
      if(!lines.length) throw new Error("请填写至少一项大于 0 的期初数量。");
      const b=await requestJson("/api/inventory-reports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({warehouseId:warehouses[0]?.id,businessDate:today(),lines})}); setSelected({}); setMessage(`已确认 ${b.count} 条期初库存。`); await refresh();
    } catch(e) { setMessage(e instanceof Error ? e.message : "保存失败，输入已保留。"); } finally { setBusy(false); }
  };
  const pager = (slice: ReturnType<typeof pageSlice>, setPage: (value: number) => void) => <TablePager {...slice} onPageChange={setPage} onPageSizeChange={setPageSize}/>;
  return <section className="card inventory-reports-desk"><h2>库存报表与期初库存</h2><p>期初库存只适用于从未产生库存流水的商品；已经有账本的商品请使用盘点调整，避免覆盖历史。</p>{message && <OperationDialog title="操作提示" onClose={() => setMessage("")}><p>{message}</p><button className="primary" onClick={() => setMessage("")}>知道了</button></OperationDialog>}<label>查看期间 <input type="month" value={period} onChange={e=>setPeriod(e.target.value)}/></label>
    <h3>期初库存向导</h3><div className="stock-table-wrap"><table className="stock-table"><thead><tr><th>商品</th><th>库存单位</th><th>期初数量</th><th>单价（元）</th></tr></thead><tbody>{opening.rows.length ? opening.rows.map((x:any)=><tr key={x.id}><td>{x.name}<small>{x.sku}</small></td><td>{x.stockUom}</td><td><input disabled={busy} type="number" min="0" step="any" value={selected[x.id]?.qty||""} onChange={e=>setSelected({...selected,[x.id]:{...selected[x.id],qty:e.target.value}})}/></td><td><input disabled={busy} type="number" min="0" step="0.01" value={selected[x.id]?.cost||""} onChange={e=>setSelected({...selected,[x.id]:{...selected[x.id],cost:e.target.value}})}/></td></tr>) : <tr><td className="empty" colSpan={4}>没有需要建立期初库存的商品。</td></tr>}</tbody></table></div>{pager(opening,setOpeningPage)}<button disabled={busy} onClick={commit}>确认写入期初库存</button>
    <h3>领料汇总</h3><div className="stock-table-wrap"><table className="stock-table"><thead><tr><th>分类</th><th>商品</th><th>领料数量</th><th>成本金额</th></tr></thead><tbody>{issues.rows.length ? issues.rows.map((x:any,i:number)=><tr key={`${x.itemName}-${i}`}><td>{x.category}</td><td>{x.itemName}</td><td>{x.quantity} {x.stockUom}</td><td>¥{x.amount.toFixed(2)}</td></tr>) : <tr><td className="empty" colSpan={4}>本期暂无领料数据。</td></tr>}</tbody></table></div>{pager(issues,setIssuePage)}
    <h3>采购成本趋势</h3><div className="stock-table-wrap"><table className="stock-table"><thead><tr><th>商品</th><th>日期</th><th>采购单价</th></tr></thead><tbody>{trends.rows.length ? trends.rows.map((x:any,i:number)=><tr key={`${x.itemName}-${x.businessDate}-${i}`}><td>{x.itemName}</td><td>{x.businessDate}</td><td>¥{unitPrice(x.unitCost)}/{x.stockUom}</td></tr>) : <tr><td className="empty" colSpan={3}>本期暂无采购成本记录。</td></tr>}</tbody></table></div>{pager(trends,setTrendPage)}
    <h3>菜品毛利档案</h3><div className="stock-table-wrap"><table className="stock-table"><thead><tr><th>分类</th><th>菜品</th><th>售价</th><th>每份成本</th><th>毛利率</th></tr></thead><tbody>{margins.rows.length ? margins.rows.map((x:any,i:number)=><tr key={`${x.productName}-${i}`}><td>{x.category}</td><td>{x.productName}</td><td>¥{x.sellingPrice.toFixed(2)}</td><td>¥{x.cost.toFixed(2)}</td><td>{x.grossMargin}%</td></tr>) : <tr><td className="empty" colSpan={5}>暂无菜品毛利档案。</td></tr>}</tbody></table></div>{pager(margins,setMarginPage)}
  </section>;
}
