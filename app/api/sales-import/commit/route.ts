import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { localStore } from "@/lib/local-store";
import { ready } from "@/lib/services";
import { commitSalesImport } from "@/lib/reconciliation";

const schema = z.object({ warehouseId: z.string().min(1), preview: z.object({ fileName: z.string(), fileHash: z.string(), businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), sheetName: z.string(), lines: z.array(z.object({ row: z.number(), salesSku: z.string(), dishName: z.string().min(1), quantity: z.number().positive() })), warnings: z.array(z.string()), errors: z.array(z.string()) }) });

export async function POST(request: NextRequest) {
  try {
    await ready();
    const input = schema.parse(await request.json());
    return NextResponse.json(commitSalesImport({ ...input, storeId: localStore.storeId, actor: localStore.actor }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "销售导入失败" }, { status: 400 });
  }
}
