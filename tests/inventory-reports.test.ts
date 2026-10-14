import { describe, expect, it } from "vitest";
import { calculateCogs } from "@/lib/domain/inventory";

describe("库存报表口径", () => {
  it("销售成本按期初加净入库减期末计算", () => {
    expect(calculateCogs(10000, 5000, 1000, 3000, 0)).toBe(11000);
  });
});
