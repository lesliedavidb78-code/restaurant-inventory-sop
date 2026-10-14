import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSession, createUserWithStore, SESSION_COOKIE, STORE_COOKIE } from "@/lib/auth";

const schema = z.object({ username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_.-]+$/), displayName: z.string().trim().min(2).max(30), password: z.string().min(8).max(100), storeName: z.string().trim().min(2).max(50), storeCode: z.string().trim().min(2).max(20).regex(/^[a-zA-Z0-9_-]+$/) });
export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const created = createUserWithStore(body); const session = createSession(created.userId);
    const response = NextResponse.json({ ok: true, storeId: created.storeId });
    response.cookies.set(SESSION_COOKIE, session.id, { httpOnly: true, sameSite: "lax", expires: session.expires, path: "/" });
    response.cookies.set(STORE_COOKIE, created.storeId, { httpOnly: true, sameSite: "lax", expires: session.expires, path: "/" });
    return response;
  } catch (error) { return NextResponse.json({ error: error instanceof Error && error.message.includes("UNIQUE") ? "账号或门店编码已存在" : "注册信息不符合要求" }, { status: 400 }); }
}
