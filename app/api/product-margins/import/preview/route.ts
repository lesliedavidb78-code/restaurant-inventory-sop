import { NextRequest, NextResponse } from "next/server";
import { parseProductMarginFile } from "@/lib/product-margin-importer";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData(); const file = form.get("file"); const period = String(form.get("period") ?? "2026-06");
    if (!(file instanceof File)) throw new Error("请选择 Word 或 Excel 文件");
    if (!/\.(docx|xlsx)$/i.test(file.name)) throw new Error("仅支持 .docx 或 .xlsx 文件");
    return NextResponse.json(parseProductMarginFile(Buffer.from(await file.arrayBuffer()), file.name, period));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "文件解析失败" }, { status: 400 }); }
}
