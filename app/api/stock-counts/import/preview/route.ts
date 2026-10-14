import { NextRequest, NextResponse } from "next/server";
import { localStore } from "@/lib/local-store";
import { ready } from "@/lib/services";
import { getStockCount } from "@/lib/reconciliation";
import { parseStockCountWorkbook } from "@/lib/stock-count-import";

export async function POST(request: NextRequest) {
  try {
    await ready();
    const form = await request.formData();
    const countId = String(form.get("countId") ?? "").trim();
    const file = form.get("file");
    if (!countId || !(file instanceof File)) throw new Error("请选择盘点草稿和 Excel 文件。");
    if (!/\.xlsx$/i.test(file.name)) throw new Error("目前仅支持系统下载后回传的 .xlsx 盘点表。");
    if (file.size > 10 * 1024 * 1024) throw new Error("盘点表不能超过 10MB，请拆分后导入。");
    const detail = getStockCount(localStore.storeId, countId) as { count: { status: string }; lines: { itemId: string; sku: string; itemName: string }[] };
    if (detail.count.status !== "draft") throw new Error("已确认的盘点单不能再导入，请新建盘点草稿。");
    const preview = parseStockCountWorkbook(Buffer.from(await file.arrayBuffer()), file.name, detail.lines);
    return NextResponse.json(preview);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "盘点表解析失败" }, { status: 400 }); }
}
