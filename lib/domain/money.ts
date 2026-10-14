export const toCents = (value: number | null | undefined) => Math.round((value ?? 0) * 100);
export const fromCents = (value: number) => value / 100;

export const formatMoney = (cents: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(fromCents(cents));

export const formatPercent = (value: number) =>
  new Intl.NumberFormat("zh-CN", { style: "percent", minimumFractionDigits: 2 }).format(value);
