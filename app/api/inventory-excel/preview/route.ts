import { NextRequest, NextResponse } from "next/server";
import { parseInventoryWorkbook } from "@/lib/inventory-excel-import";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "请选择 .xlsx Excel 文件" }, { status: 400 });
    return NextResponse.json(parseInventoryWorkbook(Buffer.from(await file.arrayBuffer()), file.name));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Excel 解析失败" }, { status: 400 });
  }
}
