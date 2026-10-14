import { NextRequest, NextResponse } from "next/server";
import { parseWordTables } from "@/lib/word-import";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData(); const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".docx")) return NextResponse.json({ error: "请选择 .docx Word 文件" }, { status: 400 });
    return NextResponse.json(await parseWordTables(Buffer.from(await file.arrayBuffer()), file.name));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Word 解析失败" }, { status: 400 }); }
}
