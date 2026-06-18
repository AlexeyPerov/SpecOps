import { describe, expect, it } from "vitest";
import {
  buildSlashReplacement,
  filterCommands,
  shouldTriggerSlashPopover,
} from "./opencodeCommands";
import type { OpencodeCommandEntry } from "./workspaceAgentBackend";

function command(overrides: Partial<OpencodeCommandEntry> = {}): OpencodeCommandEntry {
  const base: OpencodeCommandEntry = {
    name: "review",
    template: "Review this code",
  };
  if (overrides.description !== undefined) base.description = overrides.description;
  if (overrides.agent !== undefined) base.agent = overrides.agent;
  if (overrides.subtask !== undefined) base.subtask = overrides.subtask;
  if (overrides.name !== undefined) base.name = overrides.name;
  if (overrides.template !== undefined) base.template = overrides.template;
  return base;
}

describe("opencodeCommands.filterCommands", () => {
  it("returns all commands for an empty query", () => {
    const commands = [command({ name: "init" }), command({ name: "review" })];
    expect(filterCommands(commands, "")).toEqual(commands);
  });

  it("returns all commands for a whitespace-only query", () => {
    const commands = [command({ name: "init" })];
    expect(filterCommands(commands, "   ")).toEqual(commands);
  });

  it("filters by name (case-insensitive substring)", () => {
    const commands = [
      command({ name: "init" }),
      command({ name: "review", description: "Code review" }),
    ];
    const result = filterCommands(commands, "REV");
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("review");
    expect(result[0]!.description).toBe("Code review");
  });

  it("filters by description", () => {
    const commands = [
      command({ name: "init", description: "Set up the project" }),
      command({ name: "review", description: "Code review" }),
    ];
    const result = filterCommands(commands, "set up");
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("init");
  });

  it("returns an empty list when nothing matches", () => {
    const commands = [command({ name: "init" })];
    expect(filterCommands(commands, "zzz")).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const commands = [command({ name: "init" }), command({ name: "review" })];
    const snapshot = [...commands];
    filterCommands(commands, "init");
    expect(commands).toEqual(snapshot);
  });
});

describe("opencodeCommands.shouldTriggerSlashPopover", () => {
  it("triggers on a bare slash at the start", () => {
    expect(shouldTriggerSlashPopover("/", 1)).toEqual({ trigger: true, query: "" });
  });

  it("triggers on a slash + query at the start", () => {
    expect(shouldTriggerSlashPopover("/in", 3)).toEqual({ trigger: true, query: "in" });
  });

  it("triggers on a slash after whitespace", () => {
    expect(shouldTriggerSlashPopover("hello /rev", 10)).toEqual({
      trigger: true,
      query: "rev",
    });
  });

  it("does not trigger when the slash is inside a word", () => {
    expect(shouldTriggerSlashPopover("https://example", 8)).toEqual({
      trigger: false,
      query: "",
    });
  });

  it("does not trigger when the slash is followed by whitespace", () => {
    // Caret past the space — text up to caret is "/ " which has no trailing
    // non-whitespace token after the slash.
    expect(shouldTriggerSlashPopover("/ ", 2)).toEqual({ trigger: false, query: "" });
  });

  it("does not trigger when there is no slash", () => {
    expect(shouldTriggerSlashPopover("hello world", 11)).toEqual({
      trigger: false,
      query: "",
    });
  });

  it("uses the caret to bound the trigger (text after caret is ignored)", () => {
    // `/rev end` — caret at position 4 means only `/rev` is considered.
    expect(shouldTriggerSlashPopover("/rev end", 4)).toEqual({
      trigger: true,
      query: "rev",
    });
  });

  it("treats an out-of-range caret as no trigger", () => {
    expect(shouldTriggerSlashPopover("/rev", 99)).toEqual({ trigger: false, query: "" });
  });
});

describe("opencodeCommands.buildSlashReplacement", () => {
  it("replaces the trigger token with the template at the start of the draft", () => {
    const result = buildSlashReplacement({
      value: "/rev",
      caret: 4,
      template: "Review this code",
    });
    expect(result.value).toBe("Review this code");
    expect(result.caret).toBe("Review this code".length);
  });

  it("replaces the trigger token after a space and preserves the rest of the text", () => {
    const result = buildSlashReplacement({
      value: "hello /rev",
      caret: 11,
      template: "Review this code",
    });
    expect(result.value).toBe("hello Review this code");
    expect(result.caret).toBe("hello Review this code".length);
  });

  it("preserves text after the caret", () => {
    const result = buildSlashReplacement({
      value: "/rev and more",
      caret: 4,
      template: "Review this code",
    });
    expect(result.value).toBe("Review this code and more");
    expect(result.caret).toBe("Review this code".length);
  });

  it("appends with a separating space when no slash is present", () => {
    const result = buildSlashReplacement({
      value: "hello",
      caret: 5,
      template: "/review",
    });
    expect(result.value).toBe("hello /review");
    expect(result.caret).toBe("hello /review".length);
  });

  it("does not insert a separating space when the draft already ends with one", () => {
    const result = buildSlashReplacement({
      value: "hello ",
      caret: 6,
      template: "/review",
    });
    expect(result.value).toBe("hello /review");
  });

  it("does not treat a slash inside a word (https://) as a trigger", () => {
    const result = buildSlashReplacement({
      value: "https://example.com",
      caret: 19,
      template: "/review",
    });
    expect(result.value).toBe("https://example.com /review");
  });
});
