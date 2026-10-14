import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { localStore } from "@/lib/local-store";
import { ready } from "@/lib/services";
import { confirmSalesRecipe, getReconciliation } from "@/lib/reconciliation";

export async function GET() {
  try { await ready(); return NextResponse.json(getReconciliation(localStore.storeId)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "读取对账数据失败" }, { status: 500 }); }
}

export async function PATCH(request: NextRequest) {
  try {
    await ready();
    const input = z.object({ lineId: z.string().min(1), recipeId: z.string().min(1), warehouseId: z.string().min(1).optional() }).parse(await request.json());
    confirmSalesRecipe({ ...input, storeId: localStore.storeId, actor: localStore.actor });
    return NextResponse.json({ message: "销售菜品已确认匹配，理论耗用已生成；实际库存未被修改。" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "确认销售菜品失败" }, { status: 400 });
  }
}
