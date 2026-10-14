import { NextRequest, NextResponse } from "next/server";
import { commitImport, type ImportPreview } from "@/lib/importer";

export async function POST(request: NextRequest) {
  try {
    const preview = await request.json() as ImportPreview;
    const role = request.headers.get("x-role") ?? "finance";
    if (!['owner','finance'].includes(role)) return NextResponse.json({ error: "当前角色无导入权限" }, { status: 403 });
    return NextResponse.json(commitImport(preview, request.headers.get("x-actor") ?? "财务"));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "提交失败" }, { status: 400 });
  }
}
