import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendStockEvent, getDashboard } from "@/lib/services";
import { localStore } from "@/lib/local-store";

const schema = z.object({
  itemId: z.string().min(1), warehouseId: z.string().min(1),
  eventType: z.enum(["purchase", "sale", "return", "transfer_in", "transfer_out", "issue", "issue_return", "waste", "adjustment"]),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), quantity: z.number().positive(),
  quantityUom: z.enum(["purchase", "stock"]), unitCostCents: z.number().finite().nonnegative().optional(), note: z.string().max(200).optional(),
  requestId: z.string().min(8).max(100).optional(),
});

export async function GET() {
  const dashboard = await getDashboard(localStore.storeId);
  return NextResponse.json({ stock: dashboard.stock, items: dashboard.items, warehouses: dashboard.warehouses });
}

export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    return NextResponse.json(await appendStockEvent({ ...body, ...localStore }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "库存写入失败" }, { status: 400 });
  }
}
