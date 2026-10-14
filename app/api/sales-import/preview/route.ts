import { NextRequest, NextResponse } from "next/server";
import { parseSalesWorkbook } from "@/lib/sales-import";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !/\.xlsx$/i.test(file.name)) throw new Error("请选择 .xlsx 销售明细 Excel 文件。");
    return NextResponse.json(parseSalesWorkbook(Buffer.from(await file.arrayBuffer()), file.name));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "销售 Excel 解析失败" }, { status: 400 });
  }
}
