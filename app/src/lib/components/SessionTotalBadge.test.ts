import { describe, expect, it } from "vitest";
import type { ChatSessionTotals } from "../ai/chatSteps";
import SessionTotalBadge from "./SessionTotalBadge.svelte";
import { mountComponent } from "./_testComponentMount";

function totals(overrides: Partial<ChatSessionTotals> = {}): ChatSessionTotals {
  return {
    cost: 0.0123,
    tokens: {
      input: 1234,
      output: 567,
      reasoning: 0,
      cache: { read: 100, write: 5 },
    },
    messageCount: 3,
    ...overrides,
  };
}

describe("SessionTotalBadge.svelte", () => {
  it("renders the input / output / cache token fields with compact formatting", () => {
    const { host } = mountComponent(SessionTotalBadge, {
      totals: totals(),
    });
    const tokens = host.querySelector(".session-total-tokens");
    expect(tokens?.textContent).toContain("1.2k"); // input 1234
    expect(tokens?.textContent).toContain("567"); // output 567
    expect(tokens?.textContent).toContain("105"); // cache read+write = 105
  });

  it("renders the formatted cost", () => {
    const { host } = mountComponent(SessionTotalBadge, {
      totals: totals({ cost: 0.0123 }),
    });
    expect(host.querySelector(".session-total-cost")?.textContent).toBe("$0.0123");
  });

  it("carries the full token breakdown in the hover title", () => {
    const { host } = mountComponent(SessionTotalBadge, {
      totals: totals(),
    });
    const title = host.querySelector(".session-total-badge")?.getAttribute("title") ?? "";
    expect(title).toContain("input: 1,234");
    expect(title).toContain("output: 567");
    expect(title).toContain("cache read: 100");
    expect(title).toContain("cache write: 5");
    expect(title).toContain("reasoning: 0");
    expect(title).toContain("cost: $0.0123");
  });

  it("renders a cost-only aria-label for screen readers", () => {
    const { host } = mountComponent(SessionTotalBadge, {
      totals: totals({ cost: 2.5 }),
    });
    // formatCost trims trailing zeros, so $2.50 → "$2.5".
    expect(host.querySelector(".session-total-badge")?.getAttribute("aria-label")).toBe(
      "Session cost $2.5",
    );
  });

  it("formats a sub-cent cost with trailing-zero trimming", () => {
    const { host } = mountComponent(SessionTotalBadge, {
      totals: totals({ cost: 0.05 }),
    });
    expect(host.querySelector(".session-total-cost")?.textContent).toBe("$0.05");
  });
});
