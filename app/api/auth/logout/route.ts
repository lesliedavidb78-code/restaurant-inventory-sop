import { NextRequest, NextResponse } from "next/server";
import { sqlite } from "@/lib/db"; import { SESSION_COOKIE, STORE_COOKIE } from "@/lib/auth";
export async function POST(request: NextRequest) { const id = request.cookies.get(SESSION_COOKIE)?.value; if (id) sqlite.prepare("DELETE FROM sessions WHERE id=?").run(id); const response = NextResponse.json({ ok: true }); response.cookies.delete(SESSION_COOKIE); response.cookies.delete(STORE_COOKIE); return response; }
