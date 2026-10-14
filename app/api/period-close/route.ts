import { NextRequest, NextResponse } from "next/server";
import { closePeriod } from "@/lib/services";

export async function POST(request: NextRequest) {
  try {
    const { period } = await request.json();
    return NextResponse.json(await closePeriod(period, request.headers.get("x-actor") ?? "店长", request.headers.get("x-role") ?? "owner"));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "月结失败" }, { status: 400 });
  }
}
