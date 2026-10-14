export type ProductMarginInput = {
  sellingPriceCents: number;
  purchasePriceCents: number;
  auxiliaryCostCents?: number;
  portionQty?: number;
  yieldRate?: number;
  freightCents?: number;
};

export function calculateProductMargin(input: ProductMarginInput) {
  const auxiliaryCostCents = input.auxiliaryCostCents ?? 0;
  const portionQty = input.portionQty ?? 1;
  const yieldRate = input.yieldRate ?? 1;
  const freightCents = input.freightCents ?? 0;
  if (input.sellingPriceCents <= 0) throw new Error("售价必须大于 0");
  if (input.purchasePriceCents < 0 || auxiliaryCostCents < 0 || freightCents < 0) throw new Error("成本金额不能为负数");
  if (portionQty <= 0) throw new Error("出品分量必须大于 0");
  if (yieldRate <= 0) throw new Error("净料率必须大于 0");
  const netMaterialPriceCents = Math.round((input.purchasePriceCents + auxiliaryCostCents) / yieldRate);
  const costCents = Math.round(netMaterialPriceCents * portionQty + freightCents);
  const grossProfitCents = input.sellingPriceCents - costCents;
  const grossMargin = grossProfitCents / input.sellingPriceCents;
  return { netMaterialPriceCents, costCents, grossProfitCents, grossMargin };
}
