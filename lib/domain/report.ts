export type ProfitInput = {
  grossRevenueCents: number;
  cogsCents: number;
  expenseCents: number;
};

export function calculateProfit(input: ProfitInput) {
  const grossProfitCents = input.grossRevenueCents - input.cogsCents;
  const operatingProfitCents = grossProfitCents - input.expenseCents;
  return {
    grossProfitCents,
    grossMargin: input.grossRevenueCents === 0 ? 0 : grossProfitCents / input.grossRevenueCents,
    operatingProfitCents,
    operatingMargin: input.grossRevenueCents === 0 ? 0 : operatingProfitCents / input.grossRevenueCents,
  };
}
