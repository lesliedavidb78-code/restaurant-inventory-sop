import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { localStore } from "@/lib/local-store";
import { ready } from "@/lib/services";
import { saveStockCountLines } from "@/lib/reconciliation";

const inputSchema = z.object({
  countId: z.string().min(1),
  lines: z.array(z.object({ itemId: z.string().min(1), countedQuantity: z.number().nonnegative(), reason: z.string().max(120).default("") })).min(1),
});

export async function POST(request: NextRequest) {
  try {
    await ready();
    const input = inputSchema.parse(await request.json());
    saveStockCountLines({ ...input, storeId: localStore.storeId });
    return NextResponse.json({ message: `已写入 ${input.lines.length} 条实盘数据，尚未确认盘点，因此库存未改变。` });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "写入盘点数据失败" }, { status: 400 }); }
}
