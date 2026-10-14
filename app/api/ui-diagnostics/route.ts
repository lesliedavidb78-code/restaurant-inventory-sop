import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const eventSchema = z.object({
  event: z.enum([
    "delete_started", "delete_api_success", "delete_interaction_released", "delete_refresh_started", "delete_refresh_finished", "delete_refresh_failed", "delete_finally",
    "open_item_editor", "open_record_editor", "navigate",
  ]),
  page: z.string().max(20),
  busy: z.boolean(),
  detail: z.string().max(160).optional(),
});

function logFile() {
  const dataDir = process.env.RESTAURANT_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dataDir, "删除与编辑诊断日志.txt");
}

/** 仅定位删除后无法编辑，不记录商品名称、金额、客户信息或文件内容。 */
export async function POST(request: NextRequest) {
  try {
    const input = eventSchema.parse(await request.json());
    const row = `[UI-DELETE-DIAG] ${new Date().toISOString()} event=${input.event} page=${input.page} busy=${input.busy}${input.detail ? ` detail=${input.detail.replace(/[\r\n]/g, " ")}` : ""}\n`;
    await fs.mkdir(path.dirname(logFile()), { recursive: true });
    await fs.appendFile(logFile(), row, "utf8");
    return NextResponse.json({ ok: true });
  } catch {
    // 诊断失败绝不能影响库存业务本身。
    return NextResponse.json({ ok: false });
  }
}
