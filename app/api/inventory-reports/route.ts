import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { localStore } from "@/lib/local-store";
import { commitOpeningStock, getInventoryReports } from "@/lib/inventory-reports";
import { businessDate } from "@/lib/domain/business-date";

const body = z.object({ warehouseId: z.string().min(1), businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), lines: z.array(z.object({ itemId: z.string().min(1), quantity: z.number().positive(), quantityUom: z.enum(["purchase", "stock"]), unitCostCents: z.number().finite().nonnegative() })).min(1) });
export async function GET(req: NextRequest) { try { const period = req.nextUrl.searchParams.get("period") || businessDate().slice(0,7); return NextResponse.json(await getInventoryReports(localStore.storeId, period)); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "读取库存报表失败" }, { status: 400 }); } }
export async function POST(req: NextRequest) { try { return NextResponse.json(await commitOpeningStock({ ...localStore, ...body.parse(await req.json()) })); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "保存期初库存失败" }, { status: 400 }); } }
