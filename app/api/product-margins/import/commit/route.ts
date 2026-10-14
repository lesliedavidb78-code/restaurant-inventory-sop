import { NextRequest, NextResponse } from "next/server";
import { commitProductMarginImport, type ProductMarginImportPreview } from "@/lib/product-margin-importer";

export async function POST(request: NextRequest) {
  try {
    const role = request.headers.get("x-role") ?? "finance";
    if (!['owner','finance'].includes(role)) return NextResponse.json({ error: "当前角色无导入权限" }, { status: 403 });
    return NextResponse.json(commitProductMarginImport(await request.json() as ProductMarginImportPreview, request.headers.get("x-actor") ?? "财务"));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "导入提交失败" }, { status: 400 }); }
}
