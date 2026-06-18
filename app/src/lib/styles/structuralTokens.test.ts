import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M6-T1 — Theme compatibility: the phase-3.5 components (ReasoningBlock,
 * SubtaskCard, TodoPanel, StatusPopover, SessionListPanel, DiffViewerPanel,
 * SessionTimelineDialog, …) plus pre-existing CSS (chat-composer, chatProse)
 * reference structural spacing/surface/border/selection tokens that were
 * historically never defined. This test pins their presence in tokens.css so
 * the gaps don't silently regress.
 */

const TOKENS_CSS = readFileSync(
  join(import.meta.dirname, "tokens.css"),
  "utf8",
);

const STRUCTURAL_SPACING_TOKENS = [
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-5",
  "--space-6",
  "--space-8",
  "--space-10",
  "--space-12",
] as const;

const STRUCTURAL_COLOR_TOKENS = [
  "--color-surface-0",
  "--color-surface-1",
  "--color-surface-2",
  "--color-border-subtle",
  "--color-border-strong",
  "--color-selection",
  "--color-danger",
] as const;

/** Extracts the body of a CSS rule for a given selector, or null if absent. */
function ruleBodyFor(source: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m").exec(source);
  return match ? match[1] ?? "" : null;
}

describe("tokens.css structural spacing scale", () => {
  const rootBody = ruleBodyFor(TOKENS_CSS, ":root");
  expect(rootBody).not.toBeNull();

  it.each(STRUCTURAL_SPACING_TOKENS)("defines %s on :root", (token) => {
    expect(rootBody).toContain(`${token}:`);
  });
});

describe("tokens.css font-size tokens", () => {
  const rootBody = ruleBodyFor(TOKENS_CSS, ":root");
  expect(rootBody).not.toBeNull();

  it("defines ui/editor/chat font-size variables on :root", () => {
    expect(rootBody).toContain("--font-size-ui:");
    expect(rootBody).toContain("--font-size-editor:");
    expect(rootBody).toContain("--font-size-chat:");
  });

  it("applies --font-size-ui to the body", () => {
    // The html/body rule uses a multi-line selector; match the body block directly.
    const bodyRule = /html,\s*body\s*\{([^}]*)\}/m.exec(TOKENS_CSS);
    expect(bodyRule).not.toBeNull();
    expect(bodyRule?.[1] ?? "").toContain("font-size: var(--font-size-ui)");
  });
});

describe("tokens.css structural color tokens per theme", () => {
  it.each(["light", "dark"])("defines structural color tokens for %s theme", (mode) => {
    const body = ruleBodyFor(TOKENS_CSS, `:root[data-theme="${mode}"]`);
    expect(body).not.toBeNull();
    for (const token of STRUCTURAL_COLOR_TOKENS) {
      expect(body).toContain(`${token}:`);
    }
  });
});
