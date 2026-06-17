import { describe, expect, it, vi } from "vitest";
import type { MessageReasoning } from "../ai/chatReasoning";
import ReasoningBlock from "./ReasoningBlock.svelte";
import { mountComponent } from "./_testComponentMount";

function reasoning(overrides: Partial<MessageReasoning> = {}): MessageReasoning {
  return {
    id: "r-1",
    text: "I should check the file first.",
    ...overrides,
  };
}

describe("ReasoningBlock.svelte", () => {
  it("renders the reasoning label and text", () => {
    const { host } = mountComponent(ReasoningBlock, {
      reasoning: reasoning(),
      expanded: false,
    });
    expect(host.querySelector(".reasoning-label")?.textContent?.trim()).toBe("Reasoning");
    expect(host.querySelector(".reasoning-text")?.textContent).toBe(
      "I should check the file first.",
    );
  });

  it("applies the expanded modifier class and aria-expanded=true when expanded", () => {
    const { host } = mountComponent(ReasoningBlock, {
      reasoning: reasoning(),
      expanded: true,
    });
    expect(host.querySelector(".reasoning-block")?.classList.contains("reasoning-block-expanded"))
      .toBe(true);
    expect(
      host.querySelector<HTMLButtonElement>(".reasoning-header")?.getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("omits the expanded modifier class and aria-expanded=false when collapsed", () => {
    const { host } = mountComponent(ReasoningBlock, {
      reasoning: reasoning(),
      expanded: false,
    });
    expect(host.querySelector(".reasoning-block")?.classList.contains("reasoning-block-expanded"))
      .toBe(false);
    expect(
      host.querySelector<HTMLButtonElement>(".reasoning-header")?.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("shows a streaming hint while the model is still thinking", () => {
    const { host } = mountComponent(ReasoningBlock, {
      reasoning: reasoning(),
      expanded: false,
      streaming: true,
    });
    expect(host.querySelector(".reasoning-status")?.textContent).toContain("thinking");
  });

  it("hides the streaming hint when streaming is false", () => {
    const { host } = mountComponent(ReasoningBlock, {
      reasoning: reasoning(),
      expanded: false,
      streaming: false,
    });
    expect(host.querySelector(".reasoning-status")).toBeNull();
  });

  it("invokes onToggle when the header is clicked", () => {
    const onToggle = vi.fn();
    const { host } = mountComponent(ReasoningBlock, {
      reasoning: reasoning(),
      expanded: false,
      onToggle,
    });
    host.querySelector<HTMLButtonElement>(".reasoning-header")?.click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders the collapsed chevron when collapsed and expanded chevron when expanded", () => {
    const collapsed = mountComponent(ReasoningBlock, {
      reasoning: reasoning(),
      expanded: false,
    });
    expect(collapsed.host.querySelector(".reasoning-chevron")?.textContent).toBe("▸");
    collapsed.unmount();

    const expanded = mountComponent(ReasoningBlock, {
      reasoning: reasoning(),
      expanded: true,
    });
    expect(expanded.host.querySelector(".reasoning-chevron")?.textContent).toBe("▾");
  });

  it("wires aria-controls to the body wrapper id", () => {
    const { host } = mountComponent(ReasoningBlock, {
      reasoning: reasoning({ id: "abc" }),
      expanded: false,
    });
    const header = host.querySelector<HTMLButtonElement>(".reasoning-header");
    const body = host.querySelector<HTMLElement>(".reasoning-body-wrapper");
    expect(header?.getAttribute("aria-controls")).toBe("reasoning-body-abc");
    expect(body?.id).toBe("reasoning-body-abc");
  });
});
