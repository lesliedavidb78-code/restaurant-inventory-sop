export function calculateReceiptBalance(input: { orderedQuantity: number; receivedQuantity: number; returnedQuantity: number }) {
  const pendingQuantity = Math.max(0, input.orderedQuantity - input.receivedQuantity);
  const returnableQuantity = input.receivedQuantity - input.returnedQuantity;
  if (returnableQuantity < -1e-9) throw new Error("退货数量不能超过已收未退数量");
  return { pendingQuantity, returnableQuantity: Math.max(0, returnableQuantity) };
}

export function convertReceiptReturn(quantity: number, receipt: { conversionFactor: number; unitCostCents: number; receivedQuantity: number; totalCostCents: number }) {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(receipt.conversionFactor) || receipt.conversionFactor <= 0 || !Number.isFinite(receipt.receivedQuantity) || receipt.receivedQuantity <= 0 || !Number.isFinite(receipt.unitCostCents) || receipt.unitCostCents < 0 || !Number.isSafeInteger(receipt.totalCostCents) || receipt.totalCostCents < 0) throw new Error("原收货换算快照无效，请核对原收货流水。");
  return { stockQuantity: quantity * receipt.conversionFactor, conversionFactor: receipt.conversionFactor, stockUnitCostCents: receipt.unitCostCents, totalCostCents: Math.round(receipt.totalCostCents * quantity / receipt.receivedQuantity) };
}
