export type ReplenishmentEvent = {
  businessDate: string;
  eventType: string;
  quantityChange: number;
};

export type ReplenishmentInput = {
  asOfDate: string;
  currentQuantity: number;
  warningDays: number;
  targetDays: number;
  factor: number;
  events: ReplenishmentEvent[];
};

export type ReplenishmentResult = {
  historyMode: "no_data" | "available_days" | "three_complete_months";
  historyStart: string | null;
  historyEnd: string | null;
  historyDays: number;
  netUsage: number;
  averageDailyUsage: number;
  warningQuantity: number;
  targetQuantity: number;
  suggestedPurchaseQuantity: number;
  isWarning: boolean;
};

export type CategoryReplenishmentSettings = {
  name: string;
  warningDays: number;
  targetDays: number;
  factor: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const usageTypes = new Set(["sale", "issue", "issue_return"]);

function dateValue(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY_MS);
}

function daysInclusive(start: Date, end: Date) {
  return Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function threeCompleteMonthRange(asOfDate: Date) {
  const currentMonthStart = new Date(Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth(), 1));
  const start = new Date(Date.UTC(currentMonthStart.getUTCFullYear(), currentMonthStart.getUTCMonth() - 3, 1));
  return { start, end: addDays(currentMonthStart, -1) };
}

function eventUsage(event: ReplenishmentEvent) {
  if (event.eventType === "sale" || event.eventType === "issue") return Math.max(0, -event.quantityChange);
  if (event.eventType === "issue_return") return -Math.max(0, event.quantityChange);
  return 0;
}

export function resolveCategorySettings(
  category: string,
  profiles: CategoryReplenishmentSettings[],
  fallback = { warningDays: 15, targetDays: 30, factor: 1.2 },
) {
  const normalized = category.trim().toLocaleLowerCase("zh-CN");
  const matched = profiles.find((profile) => profile.name.trim().toLocaleLowerCase("zh-CN") === normalized);
  return matched
    ? { warningDays: matched.warningDays, targetDays: matched.targetDays, factor: matched.factor }
    : fallback;
}

export function calculateReplenishment(input: ReplenishmentInput): ReplenishmentResult {
  const relevantEvents = input.events
    .filter((event) => usageTypes.has(event.eventType) && event.businessDate < input.asOfDate)
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate));

  if (!relevantEvents.length) {
    return {
      historyMode: "no_data", historyStart: null, historyEnd: null, historyDays: 0, netUsage: 0,
      averageDailyUsage: 0, warningQuantity: 0, targetQuantity: 0, suggestedPurchaseQuantity: 0, isWarning: false,
    };
  }

  const asOfDate = dateValue(input.asOfDate);
  const completeRange = threeCompleteMonthRange(asOfDate);
  const firstEventDate = dateValue(relevantEvents[0].businessDate);
  const hasThreeCompleteMonths = firstEventDate.getTime() <= completeRange.start.getTime();
  const historyStart = hasThreeCompleteMonths ? completeRange.start : firstEventDate;
  const historyEnd = hasThreeCompleteMonths ? completeRange.end : addDays(asOfDate, -1);
  const historyEvents = relevantEvents.filter((event) => {
    const eventDate = dateValue(event.businessDate).getTime();
    return eventDate >= historyStart.getTime() && eventDate <= historyEnd.getTime();
  });
  const netUsage = Math.max(0, historyEvents.reduce((sum, event) => sum + eventUsage(event), 0));
  const historyDays = daysInclusive(historyStart, historyEnd);
  const averageDailyUsage = historyDays > 0 ? netUsage / historyDays : 0;
  const warningQuantity = averageDailyUsage * Math.max(0, input.warningDays);
  const targetQuantity = averageDailyUsage * Math.max(0, input.targetDays) * Math.max(0, input.factor);
  const suggestedPurchaseQuantity = Math.max(0, targetQuantity - Math.max(0, input.currentQuantity));

  return {
    historyMode: hasThreeCompleteMonths ? "three_complete_months" : "available_days",
    historyStart: isoDate(historyStart),
    historyEnd: isoDate(historyEnd),
    historyDays,
    netUsage: round(netUsage),
    averageDailyUsage: round(averageDailyUsage),
    warningQuantity: round(warningQuantity),
    targetQuantity: round(targetQuantity),
    suggestedPurchaseQuantity: round(suggestedPurchaseQuantity),
    isWarning: averageDailyUsage > 0 && input.currentQuantity <= warningQuantity,
  };
}
