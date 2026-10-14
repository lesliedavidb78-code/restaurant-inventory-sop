import { describe, expect, it } from "vitest";
import { calculateProfit } from "@/lib/domain/report";

describe("2026年6月经营复算", () => {
  it("复算毛利、毛利率和营业利润", () => {
    const result = calculateProfit({ grossRevenueCents: 74_204_030, cogsCents: 24_999_899, expenseCents: 52_504_582 });
    expect(result.grossProfitCents).toBe(49_204_131);
    expect(result.grossMargin).toBeCloseTo(0.6631, 4);
    expect(result.operatingProfitCents).toBe(-3_300_451);
    expect(result.operatingMargin).toBeCloseTo(-0.0445, 4);
  });
});
