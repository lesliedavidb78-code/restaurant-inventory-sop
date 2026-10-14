import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ready } from "@/lib/services";
import { sqlite } from "@/lib/db";
import { localStore } from "@/lib/local-store";
import { suggestSalesRecipeMatches } from "@/lib/domain/sales-matching";

const inputSchema = z.object({ products: z.array(z.object({ sku: z.string().optional(), name: z.string().trim().min(1).max(100) })).min(1).max(500) });

/** 供后续美团销量 Excel/API 导入调用；候选不会自动确认或自动扣库存。 */
export async function POST(request: NextRequest) {
  try {
    await ready();
    const input = inputSchema.parse(await request.json());
    const recipes = sqlite.prepare("SELECT id,name,sales_sku salesSku FROM recipes WHERE store_id=? AND active=1 ORDER BY name").all(localStore.storeId) as { id: string; name: string; salesSku: string }[];
    return NextResponse.json({ matches: input.products.map((product) => ({ product, candidates: suggestSalesRecipeMatches(product, recipes) })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "销售菜品匹配失败" }, { status: 400 });
  }
}
