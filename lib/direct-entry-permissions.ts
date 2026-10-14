import { z } from "zod";

const money = z.number().int().nonnegative();

export const directEntryInputSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, "账期必须为 YYYY-MM 格式"),
  sales: z.object({
    grossRevenueCents: money,
    netRevenueCents: money,
    discountCents: money,
    orderCount: z.number().int().nonnegative(),
  }),
  expenses: z.array(z.object({
    category: z.string().trim().min(1, "费用类别不能为空").max(80),
    amountCents: money,
    note: z.string().max(200).optional(),
  })),
  booths: z.array(z.object({
    name: z.string().trim().min(1, "档口名称不能为空").max(80),
    grossRevenueCents: money,
    cogsCents: money,
    netRevenueCents: money.optional(),
    discountCents: money.optional(),
    openingCents: money.optional(),
    inboundCents: money.optional(),
    outboundCents: money.optional(),
    closingCents: money.optional(),
    adjustmentCents: z.number().int().optional(),
  })),
  bankRows: z.array(z.object({
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "银行流水日期必须为 YYYY-MM-DD 格式"),
    summary: z.string().trim().min(1, "银行流水摘要不能为空").max(200),
    incomeCents: money,
    expenseCents: money,
  })),
  counterparties: z.array(z.object({
    kind: z.enum(["receivable", "payable"]),
    name: z.string().trim().min(1, "往来单位名称不能为空").max(100),
    originalCents: money,
    settledCents: money.optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "到期日必须为 YYYY-MM-DD 格式").optional(),
    note: z.string().max(200).optional(),
  })),
});

export function canUseDirectEntry(role: unknown): boolean {
  return role === "owner" || role === "manager" || role === "finance";
}

export function directEntryValidationMessage(error: z.ZodError): string {
  return `录入数据不正确：${error.issues.map((issue) => `${issue.path.join(".") || "数据"} ${issue.message}`).join("；")}`;
}
