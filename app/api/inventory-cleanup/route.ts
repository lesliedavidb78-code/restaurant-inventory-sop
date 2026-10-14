import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { localStore } from "@/lib/local-store";
import { clearStockAndMaybeDeactivate } from "@/lib/services";

const schema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  keepVisible: z.boolean(),
});

export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    return NextResponse.json(await clearStockAndMaybeDeactivate({ ...body, ...localStore }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "库存清理失败" }, { status: 400 });
  }
}
