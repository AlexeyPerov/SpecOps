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
 *
 * M11-T1 — The spacing scale must additionally be monotonic with no duplicate
 * values (a larger numeric suffix must never resolve to a smaller-or-equal
 * pixel value). The earlier scale had `--space-1 === --space-2` and
 * `--space-3 > --space-4`, which invited author mistakes; this pins the
 * ordering invariant so it can't silently regress.
 */

const TOKENS_CSS = readFileSync(
  join(import.meta.dirname, "tokens.css"),
  "utf8",
);

/** Expected M11-T1 monotonic scale (numeric suffix → px). */
const EXPECTED_SPACING_PX: Record<string, number> = {
  "--space-1": 2,
  "--space-2": 4,
  "--space-3": 6,
  "--space-4": 8,
  "--space-5": 10,
  "--space-6": 12,
  "--space-8": 16,
  "--space-10": 20,
  "--space-12": 24,
};

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

  it("resolves each spacing token to its expected px value", () => {
    for (const [token, px] of Object.entries(EXPECTED_SPACING_PX)) {
      const match = new RegExp(`${token}:\\s*([0-9.]+)px`, "m").exec(rootBody ?? "");
      expect(match, `${token} should be defined with a px value`).not.toBeNull();
      expect(Number(match?.[1] ?? NaN)).toBe(px);
    }
  });

  it("is monotonic — each step is strictly greater than the previous", () => {
    const ordered = STRUCTURAL_SPACING_TOKENS.map((token) => ({
      token,
      px: EXPECTED_SPACING_PX[token]!,
    }));
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1]!;
      const curr = ordered[i]!;
      expect(
        curr.px,
        `${curr.token} (${curr.px}px) must be > ${prev.token} (${prev.px}px)`,
      ).toBeGreaterThan(prev.px);
    }
  });

  it("has no duplicate px values across the spacing scale", () => {
    const pxValues = STRUCTURAL_SPACING_TOKENS.map((token) => EXPECTED_SPACING_PX[token]!);
    expect(new Set(pxValues).size).toBe(pxValues.length);
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
