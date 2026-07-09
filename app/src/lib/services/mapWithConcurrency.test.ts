import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./mapWithConcurrency";

describe("mapWithConcurrency", () => {
  it("preserves order and respects concurrency bound", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = [1, 2, 3, 4, 5, 6];

    const results = await mapWithConcurrency(items, 2, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return item * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50, 60]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("returns empty array for empty input", async () => {
    await expect(mapWithConcurrency([], 4, async (item) => item)).resolves.toEqual([]);
  });
});
