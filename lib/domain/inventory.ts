export type InventoryBalance = {
  quantity: number;
  valueCents: number;
  averageCostCents: number;
};

export type InventoryMovement = {
  type: "purchase" | "return" | "transfer_in" | "transfer_out" | "issue" | "issue_return" | "waste" | "adjustment";
  quantity: number;
  unitCostCents?: number;
};

export type PackConversionInput = {
  quantity: number;
  quantityUom: "purchase" | "stock";
  unitsPerPurchase: number;
  unitCostCents?: number;
};

export function convertToStockUnit(input: PackConversionInput) {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error("数量必须大于 0");
  if (!Number.isFinite(input.unitsPerPurchase) || input.unitsPerPurchase <= 0) throw new Error("包装换算数量必须大于 0");
  if (input.unitCostCents != null && (!Number.isFinite(input.unitCostCents) || input.unitCostCents < 0)) throw new Error("单价必须为有效非负数");
  const conversionFactor = input.quantityUom === "purchase" ? input.unitsPerPurchase : 1;
  const stockQuantity=input.quantity*conversionFactor;
  if (!Number.isFinite(stockQuantity)) throw new Error("换算后数量超出有效范围");
  return {
    conversionFactor,
    stockQuantity,
    // 金额仅在整笔入账时取整分，展示级每克价格不得反推原整包金额。
    stockUnitCostCents: input.unitCostCents == null ? undefined : input.unitCostCents / conversionFactor,
  };
}

const incoming = new Set(["purchase", "transfer_in", "issue_return"]);

/** 出库价值按余额比例取整分，全出时一次转完余额，不能留下残值。 */
export function outgoingInventoryValue(balance: {quantity:number;valueCents:number},quantity:number) {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("数量必须大于 0");
  if (!Number.isFinite(balance.quantity) || balance.quantity < 0 || !Number.isSafeInteger(balance.valueCents) || balance.valueCents < 0) throw new Error("现有库存数量或金额异常");
  if (quantity > balance.quantity + 1e-9) throw new Error(`库存不足，当前可用 ${balance.quantity}`);
  if (Math.abs(balance.quantity-quantity)<1e-9) return balance.valueCents;
  return Math.min(balance.valueCents,Math.max(0,Math.round(balance.valueCents*quantity/balance.quantity)));
}

export function applyMovement(balance: InventoryBalance, movement: InventoryMovement): InventoryBalance {
  if (!Number.isFinite(movement.quantity) || movement.quantity <= 0) throw new Error("数量必须大于 0");
  if (incoming.has(movement.type)) {
    if (movement.unitCostCents == null || movement.unitCostCents < 0) throw new Error("入库必须提供有效成本");
    const quantity = balance.quantity + movement.quantity;
    const valueCents = balance.valueCents + Math.round(movement.quantity * movement.unitCostCents);
    return { quantity, valueCents, averageCostCents: quantity === 0 ? 0 : valueCents / quantity };
  }

  if (movement.type === "adjustment") {
    const unit = movement.unitCostCents ?? balance.averageCostCents;
    const quantity = balance.quantity + movement.quantity;
    const valueCents = balance.valueCents + Math.round(movement.quantity * unit);
    if (quantity < -1e-9) throw new Error("盘点调整后库存不能为负数");
    return { quantity, valueCents, averageCostCents: quantity === 0 ? 0 : valueCents / quantity };
  }

  const amount=outgoingInventoryValue(balance,movement.quantity);
  const quantity = Math.abs(balance.quantity-movement.quantity)<1e-9 ? 0 : balance.quantity-movement.quantity;
  const valueCents = balance.valueCents-amount;
  return { quantity, valueCents, averageCostCents: quantity === 0 ? 0 : valueCents / quantity };
}

export function calculateCogs(openingCents: number, inboundCents: number, outboundCents: number, closingCents: number, adjustmentCents = 0) {
  return openingCents + inboundCents - outboundCents - closingCents + adjustmentCents;
}
