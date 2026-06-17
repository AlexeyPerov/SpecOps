import { describe, expect, it, vi } from "vitest";
import type { MessageSubtask } from "../ai/chatSubtasks";
import SubtaskCard from "./SubtaskCard.svelte";
import { mountComponent } from "./_testComponentMount";

function subtask(overrides: Partial<MessageSubtask> = {}): MessageSubtask {
  return {
    id: "s-1",
    agent: "explore",
    status: "completed",
    ...overrides,
  };
}

describe("SubtaskCard.svelte", () => {
  it("renders the agent name", () => {
    const { host } = mountComponent(SubtaskCard, {
      subtask: subtask({ agent: "build" }),
      expanded: false,
    });
    expect(host.querySelector(".subtask-agent")?.textContent).toBe("build");
  });

  it("uses a ⏳ icon and Running label for running subtasks", () => {
    const { host } = mountComponent(SubtaskCard, {
      subtask: subtask({ status: "running" }),
      expanded: false,
    });
    expect(host.querySelector(".subtask-status-icon")?.textContent).toBe("⏳");
    expect(host.querySelector(".subtask-status-label")?.textContent).toBe("Running");
    expect(host.querySelector(".subtask-card")?.classList.contains("subtask-card-running")).toBe(
      true,
    );
  });

  it("uses a ✓ icon and Completed label for completed subtasks", () => {
    const { host } = mountComponent(SubtaskCard, {
      subtask: subtask({ status: "completed" }),
      expanded: false,
    });
    expect(host.querySelector(".subtask-status-icon")?.textContent).toBe("✓");
    expect(host.querySelector(".subtask-status-label")?.textContent).toBe("Completed");
    expect(host.querySelector(".subtask-card")?.classList.contains("subtask-card-completed")).toBe(
      true,
    );
  });

  it("uses a ✗ icon and Failed label for failed subtasks", () => {
    const { host } = mountComponent(SubtaskCard, {
      subtask: subtask({ status: "failed" }),
      expanded: false,
    });
    expect(host.querySelector(".subtask-status-icon")?.textContent).toBe("✗");
    expect(host.querySelector(".subtask-status-label")?.textContent).toBe("Failed");
    expect(host.querySelector(".subtask-card")?.classList.contains("subtask-card-failed")).toBe(
      true,
    );
  });

  it("disables the header button and omits the chevron when there are no expandable details", () => {
    const { host } = mountComponent(SubtaskCard, {
      subtask: subtask({ status: "running" }),
      expanded: false,
    });
    const header = host.querySelector<HTMLButtonElement>(".subtask-header");
    expect(header?.disabled).toBe(true);
    expect(host.querySelector(".subtask-chevron")).toBeNull();
  });

  it("renders the first non-empty output line as a summary in the header", () => {
    const { host } = mountComponent(SubtaskCard, {
      subtask: subtask({ output: "found 3 files\nmore detail on next line" }),
      expanded: false,
    });
    expect(host.querySelector(".subtask-summary")?.textContent).toBe("found 3 files");
  });

  it("truncates a long first output line with an ellipsis", () => {
    const longLine = "x".repeat(120);
    const { host } = mountComponent(SubtaskCard, {
      subtask: subtask({ output: longLine }),
      expanded: false,
    });
    const summary = host.querySelector(".subtask-summary")?.textContent ?? "";
    expect(summary.endsWith("…")).toBe(true);
    expect(summary.length).toBeLessThan(longLine.length);
  });

  it("omits the summary when output is empty", () => {
    const { host } = mountComponent(SubtaskCard, {
      subtask: subtask({ prompt: "look around" }),
      expanded: false,
    });
    expect(host.querySelector(".subtask-summary")).toBeNull();
  });

  it("renders the description, prompt and output in the expanded body", () => {
    const { host } = mountComponent(SubtaskCard, {
      subtask: subtask({
        description: "Search the codebase",
        prompt: "find all usages",
        output: "found 3 files",
      }),
      expanded: true,
    });
    expect(host.querySelector(".subtask-description")?.textContent).toBe("Search the codebase");
    expect(host.querySelector(".subtask-section:nth-child(2) .subtask-pre")?.textContent).toBe(
      "find all usages",
    );
    expect(host.querySelector(".subtask-section:last-child .subtask-pre")?.textContent).toBe(
      "found 3 files",
    );
  });

  it("prefers the error section over the output section when both are present", () => {
    const { host } = mountComponent(SubtaskCard, {
      subtask: subtask({
        output: "partial result",
        error: "boom",
      }),
      expanded: true,
    });
    expect(host.querySelector(".subtask-section-error")).not.toBeNull();
    // Output section is skipped when an error is present.
    const pres = Array.from(host.querySelectorAll(".subtask-pre")).map((el) => el.textContent);
    expect(pres).toContain("boom");
    expect(pres).not.toContain("partial result");
  });

  it("invokes onToggle when an enabled header is clicked", () => {
    const onToggle = vi.fn();
    const { host } = mountComponent(SubtaskCard, {
      subtask: subtask({ prompt: "p" }),
      expanded: false,
      onToggle,
    });
    host.querySelector<HTMLButtonElement>(".subtask-header")?.click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("does not invoke onToggle when the disabled header is clicked", () => {
    const onToggle = vi.fn();
    const { host } = mountComponent(SubtaskCard, {
      subtask: subtask({ status: "running" }),
      expanded: false,
      onToggle,
    });
    host.querySelector<HTMLButtonElement>(".subtask-header")?.click();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("flips the chevron and aria-expanded between collapsed and expanded when details exist", () => {
    const collapsed = mountComponent(SubtaskCard, {
      subtask: subtask({ prompt: "p" }),
      expanded: false,
    });
    expect(collapsed.host.querySelector(".subtask-chevron")?.textContent).toBe("▸");
    expect(
      collapsed.host.querySelector<HTMLButtonElement>(".subtask-header")?.getAttribute(
        "aria-expanded",
      ),
    ).toBe("false");
    collapsed.unmount();

    const expanded = mountComponent(SubtaskCard, {
      subtask: subtask({ prompt: "p" }),
      expanded: true,
    });
    expect(expanded.host.querySelector(".subtask-chevron")?.textContent).toBe("▾");
    expect(
      expanded.host.querySelector<HTMLButtonElement>(".subtask-header")?.getAttribute(
        "aria-expanded",
      ),
    ).toBe("true");
  });
});
