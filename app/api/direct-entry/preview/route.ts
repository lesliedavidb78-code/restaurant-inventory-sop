import { NextRequest, NextResponse } from "next/server";
import { getSession, SESSION_COOKIE, STORE_COOKIE } from "@/lib/auth";
import { previewDirectEntry } from "@/lib/direct-entry";
import { canUseDirectEntry, directEntryInputSchema, directEntryValidationMessage } from "@/lib/direct-entry-permissions";
import { z } from "zod";

export async function POST(request: NextRequest) {
  const session = getSession(request.cookies.get(SESSION_COOKIE)?.value, request.cookies.get(STORE_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "请先登录后再进行直接录入" }, { status: 401 });
  if (!canUseDirectEntry(session.role)) return NextResponse.json({ error: "当前身份没有直接录入权限，请联系老板、店长或财务处理" }, { status: 403 });

  try {
    const input = directEntryInputSchema.parse(await request.json());
    return NextResponse.json(previewDirectEntry(input, session.storeId));
  } catch (error) {
    const message = error instanceof z.ZodError ? directEntryValidationMessage(error) : "预览失败，请检查录入内容后重试";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
