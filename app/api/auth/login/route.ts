import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sqlite, ensureSchema } from "@/lib/db";
import { createSession, SESSION_COOKIE, STORE_COOKIE, verifyPassword } from "@/lib/auth";
const schema = z.object({ username: z.string().trim().min(1), password: z.string().min(1) });
export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json()); ensureSchema();
    const user = sqlite.prepare("SELECT id,password_hash FROM users WHERE username=?").get(body.username.toLowerCase()) as { id: string; password_hash: string } | undefined;
    if (!user || !verifyPassword(body.password, user.password_hash)) return NextResponse.json({ error: "账号或密码不正确" }, { status: 401 });
    const store = sqlite.prepare("SELECT store_id FROM user_store_roles WHERE user_id=? ORDER BY created_at LIMIT 1").get(user.id) as { store_id: string } | undefined;
    if (!store) return NextResponse.json({ error: "该账号尚未分配门店" }, { status: 403 });
    const session = createSession(user.id); const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, session.id, { httpOnly: true, sameSite: "lax", expires: session.expires, path: "/" }); response.cookies.set(STORE_COOKIE, store.store_id, { httpOnly: true, sameSite: "lax", expires: session.expires, path: "/" }); return response;
  } catch { return NextResponse.json({ error: "登录失败" }, { status: 400 }); }
}
