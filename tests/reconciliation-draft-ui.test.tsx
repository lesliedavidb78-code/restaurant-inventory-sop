// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReconciliationDesk } from "@/components/reconciliation-desk";

const head={id:"draft",businessDate:"2026-10-11",mode:"open",status:"draft",note:"",warehouseName:"测试仓"};
const lines=["牛肉","毛肚"].map((name,i)=>({itemId:String(i),itemName:name,sku:String(i),category:"肉类",stockUom:"斤",bookQuantity:10,countedQuantity:null,differenceQuantity:null,differenceCostCents:0,reason:""}));
const data={pendingSales:[],recipeIssues:[],incompleteItems:[],counts:[],variance:[]};
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
function setup() {
  sessionStorage.setItem("inventory-count-draft",JSON.stringify({count:head,lines}));
  const fetchMock=vi.fn(async (url:string,options?:RequestInit)=>new Response(JSON.stringify(url==="/api/reconciliation" ? data : options?.method==="PUT" ? {adjusted:2} : {message:"保存成功"}),{status:200}));
  vi.stubGlobal("fetch",fetchMock); render(<ReconciliationDesk items={[]} warehouses={[{id:"w",name:"测试仓"}]}/>); return fetchMock;
}
describe("盘点输入保护",()=>{
  it("保存第一行不会丢掉第二行未保存输入",async()=>{
    const fetchMock=setup(); const beef=await screen.findByLabelText("牛肉实盘数"); const tripe=screen.getByLabelText("毛肚实盘数");
    fireEvent.change(beef,{target:{value:"8"}});fireEvent.change(tripe,{target:{value:"7"}});
    fireEvent.click(screen.getAllByRole("button",{name:/^保存$/})[0]);
    await waitFor(()=>expect(fetchMock.mock.calls.some(([,options])=>options?.method==="PATCH")).toBe(true));
    await screen.findByRole("button",{name:"知道了"}); expect((tripe as HTMLInputElement).value).toBe("7");
  });
  it("确认请求含全部当前输入，切页草稿保留两个数值",async()=>{
    const fetchMock=setup();fireEvent.change(await screen.findByLabelText("牛肉实盘数"),{target:{value:"8"}});fireEvent.change(screen.getByLabelText("毛肚实盘数"),{target:{value:"7"}});
    expect(JSON.parse(sessionStorage.getItem("inventory-count-draft")!).lines.map((l:any)=>l.countedQuantity)).toEqual([8,7]);
    fireEvent.click(screen.getByRole("button",{name:"确认盘点并调整库存"}));fireEvent.click(await screen.findByRole("button",{name:"确认继续"}));
    await waitFor(()=>expect(fetchMock.mock.calls.some(([,options])=>options?.method==="PUT")).toBe(true));
    const options=fetchMock.mock.calls.find(([,o])=>o?.method==="PUT")![1]; expect(JSON.parse(String(options?.body)).lines.map((l:any)=>l.countedQuantity)).toEqual([8,7]);
  });
});
