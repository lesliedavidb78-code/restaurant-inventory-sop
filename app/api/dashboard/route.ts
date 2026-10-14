import { NextRequest, NextResponse } from "next/server";
import { getDashboard } from "@/lib/services";
import { localStore } from "@/lib/local-store";

export async function GET(request: NextRequest) {
  try {
    const period = request.nextUrl.searchParams.get("period") ?? "2026-06";
    return NextResponse.json(await getDashboard(localStore.storeId, period));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取库存失败" }, { status: 500 });
  }
}
