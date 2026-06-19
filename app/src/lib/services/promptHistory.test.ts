import { describe, expect, it } from "vitest";
import {
  createPromptHistoryStore,
  frecencyScore,
  nextHistoryDown,
  nextHistoryUp,
  parseHistoryFile,
  type PromptHistoryEntry,
} from "./promptHistory";

const NOW = new Date("2026-06-18T12:00:00.000Z");
const nowFn = () => NOW;

function entry(overrides: Partial<PromptHistoryEntry> = {}): PromptHistoryEntry {
  return {
    prompt: "hello",
    firstSeenAt: "2026-06-10T00:00:00.000Z",
    lastUsedAt: "2026-06-18T00:00:00.000Z",
    count: 1,
    ...overrides,
  };
}

describe("promptHistory.store.record + list", () => {
  it("records a new prompt at the top of frecency-ordered list", () => {
    const store = createPromptHistoryStore([], undefined, { now: nowFn });
    store.record("hello");
    expect(store.list().map((e) => e.prompt)).toEqual(["hello"]);
  });

  it("increments count when recording the same prompt", () => {
    const store = createPromptHistoryStore([], undefined, { now: nowFn });
    store.record("hello");
    store.record("hello");
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]!.count).toBe(2);
  });

  it("ignores empty / whitespace-only prompts", () => {
    const store = createPromptHistoryStore([], undefined, { now: nowFn });
    store.record("");
    store.record("   ");
    expect(store.list()).toEqual([]);
  });

  it("orders by frecency — recent floats above very-old frequent", () => {
    const store = createPromptHistoryStore(
      [
        entry({
          prompt: "old-frequent",
          count: 2,
          lastUsedAt: "2026-05-01T00:00:00.000Z",
        }),
        entry({
          prompt: "recent-rare",
          count: 1,
          lastUsedAt: "2026-06-18T00:00:00.000Z",
        }),
      ],
      undefined,
      { now: nowFn },
    );
    // recent-rare (~1.0) > old-frequent (2 * ~0.01) — the latter is 48 days
    // old so the recency decay dominates the small count advantage.
    expect(store.list().map((e) => e.prompt)[0]).toBe("recent-rare");
  });

  it("caps at maxEntries, dropping least-relevant entries", () => {
    const store = createPromptHistoryStore([], undefined, {
      now: nowFn,
      maxEntries: 2,
    });
    store.record("a");
    store.record("b");
    store.record("c");
    expect(store.list()).toHaveLength(2);
  });

  it("removes a single entry by prompt text", () => {
    const store = createPromptHistoryStore([entry({ prompt: "a" }), entry({ prompt: "b" })]);
    store.remove("a");
    expect(store.list().map((e) => e.prompt)).toEqual(["b"]);
  });

  it("clear empties the history", () => {
    const store = createPromptHistoryStore([entry()]);
    store.clear();
    expect(store.list()).toEqual([]);
  });
});

describe("promptHistory.frecencyScore", () => {
  it("returns a higher score for more recent entries", () => {
    const recent = entry({ lastUsedAt: "2026-06-18T00:00:00.000Z", count: 1 });
    const old = entry({ lastUsedAt: "2026-06-01T00:00:00.000Z", count: 1 });
    expect(frecencyScore(recent, NOW)).toBeGreaterThan(frecencyScore(old, NOW));
  });

  it("returns a higher score for more frequent entries at the same recency", () => {
    const a = entry({ count: 1 });
    const b = entry({ count: 5 });
    expect(frecencyScore(b, NOW)).toBeGreaterThan(frecencyScore(a, NOW));
  });

  it("floors very old entries above zero", () => {
    const ancient = entry({ lastUsedAt: "2020-01-01T00:00:00.000Z", count: 1 });
    expect(frecencyScore(ancient, NOW)).toBeGreaterThan(0);
  });
});

describe("promptHistory.nextHistoryUp / nextHistoryDown", () => {
  const entries: PromptHistoryEntry[] = [
    entry({ prompt: "first" }),
    entry({ prompt: "second" }),
    entry({ prompt: "third" }),
  ];

  it("returns the first entry when index is -1", () => {
    expect(nextHistoryUp(entries, -1)).toEqual({ prompt: "first", index: 0 });
  });

  it("advances forward until the last entry then clamps", () => {
    expect(nextHistoryUp(entries, 0)).toEqual({ prompt: "second", index: 1 });
    expect(nextHistoryUp(entries, 1)).toEqual({ prompt: "third", index: 2 });
    expect(nextHistoryUp(entries, 2)).toEqual({ prompt: "third", index: 2 });
  });

  it("returns empty for an empty list", () => {
    expect(nextHistoryUp([], -1)).toEqual({ prompt: null, index: -1 });
  });

  it("arrow-down returns to the empty draft at index 0", () => {
    expect(nextHistoryDown(entries, 0)).toEqual({ prompt: null, index: -1 });
  });

  it("arrow-down from index 1 visits the index-0 entry (does not skip it)", () => {
    expect(nextHistoryDown(entries, 1)).toEqual({ prompt: "first", index: 0 });
  });

  it("arrow-down moves back towards the top, then drops to the empty draft", () => {
    expect(nextHistoryDown(entries, 2)).toEqual({ prompt: "second", index: 1 });
    expect(nextHistoryDown(entries, 1)).toEqual({ prompt: "first", index: 0 });
    expect(nextHistoryDown(entries, 0)).toEqual({ prompt: null, index: -1 });
  });

  it("arrow-down clamps below the draft (negative index is a no-op)", () => {
    expect(nextHistoryDown(entries, -1)).toEqual({ prompt: null, index: -1 });
  });

  it("arrow-down on an empty list is a no-op", () => {
    expect(nextHistoryDown([], -1)).toEqual({ prompt: null, index: -1 });
  });
});

describe("promptHistory.parseHistoryFile", () => {
  it("parses a well-formed history file", () => {
    const raw = JSON.stringify({
      version: 1,
      updatedAt: "2026-06-18T00:00:00.000Z",
      entries: [entry({ prompt: "hello", count: 3 })],
    });
    const parsed = parseHistoryFile(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.entries[0]!.prompt).toBe("hello");
    expect(parsed!.entries[0]!.count).toBe(3);
  });

  it("returns null for invalid JSON", () => {
    expect(parseHistoryFile("not-json")).toBeNull();
  });

  it("returns null for the wrong version", () => {
    expect(parseHistoryFile(JSON.stringify({ version: 2, entries: [] }))).toBeNull();
  });

  it("drops malformed entries", () => {
    const raw = JSON.stringify({
      version: 1,
      updatedAt: "2026-06-18T00:00:00.000Z",
      entries: [
        entry({ prompt: "ok" }),
        { prompt: "no-count" },
        { prompt: "   ", firstSeenAt: "x", lastUsedAt: "y", count: 1 },
      ],
    });
    const parsed = parseHistoryFile(raw);
    expect(parsed!.entries).toHaveLength(1);
    expect(parsed!.entries[0]!.prompt).toBe("ok");
  });
});
