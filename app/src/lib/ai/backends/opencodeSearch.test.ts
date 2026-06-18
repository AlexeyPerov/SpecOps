import { describe, expect, it } from "vitest";
import {
  buildMentionReplacement,
  filterMentionAgents,
  mentionTokenForAgent,
  mentionTokenForFile,
  shouldTriggerMentionPicker,
} from "./opencodeSearch";
import type { OpencodeAgentEntry } from "./workspaceAgentBackend";

function agent(overrides: Partial<OpencodeAgentEntry> = {}): OpencodeAgentEntry {
  return { id: "build", name: "Build", ...overrides };
}

describe("opencodeSearch.filterMentionAgents", () => {
  it("returns all agents for an empty query", () => {
    const agents = [agent({ id: "build", name: "Build" }), agent({ id: "plan", name: "Plan" })];
    const result = filterMentionAgents(agents, "");
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.id)).toEqual(["build", "plan"]);
  });

  it("filters by id (case-insensitive)", () => {
    const agents = [agent({ id: "build", name: "Build" }), agent({ id: "plan", name: "Plan" })];
    expect(filterMentionAgents(agents, "BU")).toHaveLength(1);
    expect(filterMentionAgents(agents, "BU")[0]!.id).toBe("build");
  });

  it("filters by name (case-insensitive)", () => {
    const agents = [agent({ id: "build", name: "Build" }), agent({ id: "plan", name: "Plan" })];
    expect(filterMentionAgents(agents, "pl")[0]!.id).toBe("plan");
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterMentionAgents([agent()], "zzz")).toEqual([]);
  });
});

describe("opencodeSearch.shouldTriggerMentionPicker", () => {
  it("triggers on a bare @ at the start", () => {
    expect(shouldTriggerMentionPicker("@", 1)).toEqual({ trigger: true, query: "" });
  });

  it("triggers on @ + query at the start", () => {
    expect(shouldTriggerMentionPicker("@bu", 3)).toEqual({ trigger: true, query: "bu" });
  });

  it("triggers on @ after whitespace", () => {
    expect(shouldTriggerMentionPicker("hi @bu", 6)).toEqual({ trigger: true, query: "bu" });
  });

  it("does not trigger when the @ is inside an email-like token", () => {
    expect(shouldTriggerMentionPicker("name@host", 9)).toEqual({
      trigger: false,
      query: "",
    });
  });

  it("does not trigger when there is no @", () => {
    expect(shouldTriggerMentionPicker("hello", 5)).toEqual({ trigger: false, query: "" });
  });

  it("does not trigger when @ is followed by whitespace", () => {
    expect(shouldTriggerMentionPicker("@ ", 2)).toEqual({ trigger: false, query: "" });
  });
});

describe("opencodeSearch.mentionTokenForFile / mentionTokenForAgent", () => {
  it("builds a file token with the path", () => {
    expect(mentionTokenForFile("src/index.ts")).toEqual({
      kind: "file",
      display: "@file:src/index.ts",
      value: "src/index.ts",
    });
  });

  it("builds an agent token showing the human name and storing the id", () => {
    expect(mentionTokenForAgent("build", "Build")).toEqual({
      kind: "agent",
      display: "@agent:Build",
      value: "build",
    });
  });
});

describe("opencodeSearch.buildMentionReplacement", () => {
  it("replaces the @query at the start with the token + trailing space", () => {
    const token = mentionTokenForFile("src/index.ts");
    const result = buildMentionReplacement({ value: "@src", caret: 4, token });
    expect(result.value).toBe("@file:src/index.ts ");
    expect(result.caret).toBe("@file:src/index.ts ".length);
  });

  it("replaces the @query after whitespace and preserves the rest of the text", () => {
    const token = mentionTokenForAgent("build", "Build");
    // Caret at 6 (right after "@bu", before the trailing space); the rest
    // " end" is preserved verbatim, giving a single space between token and
    // "end" because the inserted token carries its own trailing space.
    const result = buildMentionReplacement({ value: "hi @bu end", caret: 6, token });
    expect(result.value).toBe("hi @agent:Build  end");
    expect(result.caret).toBe("hi @agent:Build ".length);
  });

  it("appends with a separating space when no @ is present", () => {
    const token = mentionTokenForFile("src/index.ts");
    const result = buildMentionReplacement({ value: "hello", caret: 5, token });
    expect(result.value).toBe("hello @file:src/index.ts ");
  });

  it("does not insert a separating space when the draft already ends with one", () => {
    const token = mentionTokenForFile("src/index.ts");
    const result = buildMentionReplacement({ value: "hello ", caret: 6, token });
    expect(result.value).toBe("hello @file:src/index.ts ");
  });

  it("does not treat an @ inside a word (email) as a trigger", () => {
    const token = mentionTokenForFile("src/index.ts");
    const result = buildMentionReplacement({ value: "name@host", caret: 9, token });
    expect(result.value).toBe("name@host @file:src/index.ts ");
  });
});
