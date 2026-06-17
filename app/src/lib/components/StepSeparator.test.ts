import { describe, expect, it } from "vitest";
import type { MessageStepBoundary } from "../ai/chatSteps";
import StepSeparator from "./StepSeparator.svelte";
import { mountComponent } from "./_testComponentMount";

function boundary(overrides: Partial<MessageStepBoundary> = {}): MessageStepBoundary {
  return {
    id: "st-1",
    stepNumber: 1,
    status: "completed",
    ...overrides,
  };
}

const TOKENS = {
  input: 1234,
  output: 567,
  reasoning: 0,
  cache: { read: 100, write: 5 },
};

describe("StepSeparator.svelte", () => {
  it("renders the step number in the label and aria-label", () => {
    const { host } = mountComponent(StepSeparator, {
      boundary: boundary({ stepNumber: 3 }),
    });
    expect(host.querySelector(".step-number")?.textContent).toContain("3");
    expect(host.querySelector(".step-separator")?.getAttribute("aria-label")).toContain("Step 3");
  });

  it("applies the completed modifier class for completed steps", () => {
    const { host } = mountComponent(StepSeparator, {
      boundary: boundary({ status: "completed" }),
    });
    expect(host.querySelector(".step-separator")?.classList.contains("step-separator-completed"))
      .toBe(true);
    expect(host.querySelector(".step-separator-running")).toBeNull();
    expect(host.querySelector(".step-separator-failed")).toBeNull();
  });

  it("renders the pulsing running indicator for running steps", () => {
    const { host } = mountComponent(StepSeparator, {
      boundary: boundary({ status: "running" }),
    });
    expect(host.querySelector(".step-separator")?.classList.contains("step-separator-running"))
      .toBe(true);
    expect(host.querySelector(".step-status-running")).not.toBeNull();
    expect(host.querySelector(".step-dot")).not.toBeNull();
  });

  it("renders the failed marker for failed steps", () => {
    const { host } = mountComponent(StepSeparator, {
      boundary: boundary({ status: "failed" }),
    });
    expect(host.querySelector(".step-separator")?.classList.contains("step-separator-failed"))
      .toBe(true);
    expect(host.querySelector(".step-status-failed")?.textContent).toContain("failed");
  });

  it("renders compact token counts formatted with k suffix", () => {
    const { host } = mountComponent(StepSeparator, {
      boundary: boundary({ tokens: TOKENS }),
    });
    const tokens = host.querySelector(".step-tokens");
    expect(tokens).not.toBeNull();
    // 1234 → "1.2k", 567 → "567", cache read+write = 105 → "105"
    expect(tokens?.textContent).toContain("1.2k");
    expect(tokens?.textContent).toContain("567");
    expect(tokens?.textContent).toContain("105");
  });

  it("omits the token block when no tokens payload is present", () => {
    const { host } = mountComponent(StepSeparator, {
      boundary: boundary(),
    });
    expect(host.querySelector(".step-tokens")).toBeNull();
  });

  it("formats the cost with up to 4 decimals and trailing-zero trimming", () => {
    const { host } = mountComponent(StepSeparator, {
      boundary: boundary({ cost: 0.0123, tokens: TOKENS }),
    });
    expect(host.querySelector(".step-cost")?.textContent).toBe("$0.0123");
  });

  it("omits the cost span when cost is undefined", () => {
    const { host } = mountComponent(StepSeparator, {
      boundary: boundary({ tokens: TOKENS }),
    });
    expect(host.querySelector(".step-cost")).toBeNull();
  });

  it("carries role=separator", () => {
    const { host } = mountComponent(StepSeparator, {
      boundary: boundary(),
    });
    expect(host.querySelector(".step-separator")?.getAttribute("role")).toBe("separator");
  });
});
