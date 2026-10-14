import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { localStore } from "@/lib/local-store";
import { ready } from "@/lib/services";
import { confirmStockCount, createStockCount, deleteStockCount, getStockCount, rebaseStockCount, saveStockCountLines } from "@/lib/reconciliation";

const lineSchema = z.object({ itemId: z.string().min(1), countedQuantity: z.number().nonnegative().nullable(), reason: z.string().max(120).default("") });

export async function GET(request: NextRequest) {
  try {
    await ready();
    const id = request.nextUrl.searchParams.get("id");
    if (!id) throw new Error("请指定盘点单。");
    return NextResponse.json(getStockCount(localStore.storeId, id));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "读取盘点单失败" }, { status: 400 }); }
}

export async function POST(request: NextRequest) {
  try {
    await ready();
    const input = z.object({ warehouseId: z.string().min(1), businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), mode: z.enum(["open", "blind"]), note: z.string().max(200).default("") }).parse(await request.json());
    return NextResponse.json(createStockCount({ ...input, storeId: localStore.storeId, actor: localStore.actor }));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "创建盘点单失败" }, { status: 400 }); }
}

export async function PATCH(request: NextRequest) {
  try {
    await ready();
    const body = await request.json();
    if (body.action === "rebase") {
      const { countId } = z.object({ countId: z.string().min(1) }).parse(body);
      rebaseStockCount({ countId, storeId: localStore.storeId });
      return NextResponse.json(getStockCount(localStore.storeId, countId));
    }
    const input = z.object({ countId: z.string().min(1), lines: z.array(lineSchema).min(1) }).parse(body.lines ? body : { countId: body.countId, lines: [body] });
    saveStockCountLines({ ...input, storeId: localStore.storeId });
    return NextResponse.json({ message: "实盘数量已保存。" });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "保存盘点数量失败" }, { status: 400 }); }
}

export async function PUT(request: NextRequest) {
  try {
    await ready();
    const input = z.object({ countId: z.string().min(1), lines: z.array(lineSchema).optional() }).parse(await request.json());
    return NextResponse.json(confirmStockCount({ ...input, storeId: localStore.storeId, actor: localStore.actor }));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "确认盘点失败" }, { status: 400 }); }
}

export async function DELETE(request: NextRequest) {
  try { await ready(); const countId = request.nextUrl.searchParams.get("id"); if (!countId) throw new Error("请指定盘点单。"); deleteStockCount({ countId, storeId: localStore.storeId }); return NextResponse.json({ message: "盘点草稿已删除。" }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "删除盘点草稿失败" }, { status: 400 }); }
}
