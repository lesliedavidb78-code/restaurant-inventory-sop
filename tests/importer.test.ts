import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseWorkbook } from "@/lib/importer";

it("虚构经营表可识别八张表，不需要门店真实数据", () => {
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: unknown[][]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  const main = Array.from({ length: 85 }, () => Array(21).fill(null));
  for (const [row, label, value] of [[4,"主营业务收入",10000],[8,"主营业务成本",4000],[12,"经营毛利(率)",6000],[84,"营业利润",1000],[17,"固定成本",2000],[26,"人工成本",1000],[39,"能源成本",500],[44,"管理成本",500],[64,"营销成本",500],[77,"财务成本",300],[81,"税金",200]] as const) { main[row][2]=label; main[row][20]=value; }
  add("目录", [["目录"]]); add("门店月度经营分析表", main);
  add("档口毛利分析明细表一", [["标题"],["分类"],["示例档",10000,9500,500,1000,4000,0,null,1000,4000,6000]]);
  add("示例店营业收入概览明细表二", [["营业收入",9500],["营业额",10000],["优惠金额",500],["订单量",100]]);
  add("低值易耗附表五", [["标题"],[null],["物品编码"],[null],["DEMO001","虚构纸巾"]]);
  add("示例店银行收支明细表四", [[null],[null],["序号","日期","摘要","收入","支出","余额"],[null,null,null,null,null,2000],[null,"2026.06.30","虚构记录",100,50,2050]]);
  add("应付账款明细表六", [[null],[null],[null,"序号","名称","金额"],[null,1,"虚构供应商",1000]]);
  add("应收账款明细表七", [[null],[null],["序号","用途","金额"],[1,"虚构支付",500]]);
  const preview = parseWorkbook(Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" })), "虚构测试.xlsx");
  expect(preview.sheets).toHaveLength(8);
  expect(preview.summary.grossRevenue).toBe(10000);
  expect(preview.summary.operatingProfit).toBe(1000);
  expect(preview.errors).toEqual([]);
});
