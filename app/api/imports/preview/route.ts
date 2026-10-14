import { NextRequest, NextResponse } from "next/server";
import { parseWorkbook } from "@/lib/importer";
import { ready } from "@/lib/services";

export async function POST(request: NextRequest) {
  try {
    await ready();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "请选择 Excel 文件" }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "仅支持 .xlsx 文件" }, { status: 400 });
    return NextResponse.json(parseWorkbook(Buffer.from(await file.arrayBuffer()), file.name));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "解析失败" }, { status: 400 });
  }
}
