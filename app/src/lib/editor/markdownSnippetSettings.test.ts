import { describe, expect, it } from "vitest";
import { BUILTIN_SNIPPET_IDS, listBuiltinSnippets } from "./markdownSnippetCatalog";
import {
  collectTakenTriggers,
  defaultMarkdownSnippetSettings,
  escapeSnippetLiteral,
  listEnabledMarkdownSnippets,
  normalizeMarkdownSnippetSettings,
  normalizeUserSnippetRecord,
  prepareSnippetBody,
  validateSnippetBody,
  validateSnippetTrigger,
  validateUserSnippetDraft,
} from "./markdownSnippetSettings";

describe("builtin snippet catalog", () => {
  it("seeds a SpecOps-native Markdown catalog with unique ids and triggers", () => {
    const builtins = listBuiltinSnippets();
    expect(builtins.map((entry) => entry.id)).toEqual([...BUILTIN_SNIPPET_IDS]);
    const triggers = new Set(builtins.map((entry) => entry.trigger));
    expect(triggers.size).toBe(builtins.length);
    for (const entry of builtins) {
      expect(entry.scope).toBe("markdown");
      expect(entry.source).toBe("builtin");
      expect(entry.body.length).toBeGreaterThan(0);
      expect(validateSnippetBody(entry.body)).toBeNull();
      expect(entry.name.toLowerCase()).not.toContain("obsidian");
      expect(entry.body.toLowerCase()).not.toContain("obsidian");
    }
  });
});

describe("snippet validation", () => {
  it("rejects empty or malformed triggers and bodies", () => {
    expect(validateSnippetTrigger("")).toMatch(/empty/i);
    expect(validateSnippetTrigger("1abc")).toMatch(/letter/i);
    expect(validateSnippetBody("")).toMatch(/empty/i);
    expect(validateSnippetBody("${1:${2}}")).toMatch(/invalid/i);
    expect(validateSnippetBody("${1:ok}${0}")).toBeNull();
    expect(validateSnippetBody("wrap ${SELECTION} here${0}")).toBeNull();
  });

  it("substitutes and escapes selection tokens safely", () => {
    expect(escapeSnippetLiteral("a{b}c")).toBe("a\\{b\\}c");
    expect(prepareSnippetBody("X${SELECTION}Y", "a{b}")).toBe("Xa\\{b\\}Y");
  });
});

describe("normalizeMarkdownSnippetSettings", () => {
  it("returns documented defaults for missing input", () => {
    expect(normalizeMarkdownSnippetSettings(undefined)).toEqual(
      defaultMarkdownSnippetSettings,
    );
    expect(defaultMarkdownSnippetSettings.enabledBuiltinIds).toEqual([
      ...BUILTIN_SNIPPET_IDS,
    ]);
  });

  it("drops invalid user records and resolves duplicate triggers/ids", () => {
    const normalized = normalizeMarkdownSnippetSettings({
      enabledBuiltinIds: ["front-matter", "front-matter", "nope"],
      userSnippets: [
        {
          id: "user-a",
          name: "A",
          description: "",
          trigger: "fm", // conflicts with builtin
          body: "${1:x}${0}",
          enabled: true,
        },
        {
          id: "user-b",
          name: "B",
          description: "",
          trigger: "mycustom",
          body: "${1:x}${0}",
          enabled: true,
        },
        {
          id: "user-b",
          name: "B2",
          description: "",
          trigger: "other",
          body: "${1:x}${0}",
          enabled: true,
        },
        {
          id: "bad",
          name: "Bad",
          trigger: "x",
          body: "",
          enabled: true,
        },
      ],
    });
    expect(normalized.enabledBuiltinIds).toEqual(["front-matter"]);
    expect(normalized.userSnippets).toHaveLength(1);
    expect(normalized.userSnippets[0]?.id).toBe("user-b");
    expect(normalized.userSnippets[0]?.trigger).toBe("mycustom");
  });

  it("does not crash on malformed placeholder bodies — drops them", () => {
    const bad = normalizeUserSnippetRecord({
      id: "user-bad",
      name: "Bad",
      trigger: "badbody",
      body: "${1:${nested}}",
      enabled: true,
    });
    expect(bad).toBeNull();
  });
});

describe("listEnabledMarkdownSnippets", () => {
  it("honors builtin enable flags and user enabled flags", () => {
    const enabled = listEnabledMarkdownSnippets({
      enabledBuiltinIds: ["table"],
      userSnippets: [
        {
          id: "user-on",
          name: "On",
          description: "",
          trigger: "onx",
          body: "${1:a}${0}",
          enabled: true,
        },
        {
          id: "user-off",
          name: "Off",
          description: "",
          trigger: "offx",
          body: "${1:a}${0}",
          enabled: false,
        },
      ],
    });
    expect(enabled.map((entry) => entry.id)).toEqual(["table", "user-on"]);
  });
});

describe("validateUserSnippetDraft", () => {
  it("reports trigger conflicts before save", () => {
    const settings = normalizeMarkdownSnippetSettings({
      enabledBuiltinIds: [...BUILTIN_SNIPPET_IDS],
      userSnippets: [
        {
          id: "user-1",
          name: "One",
          description: "",
          trigger: "alpha",
          body: "${1:x}${0}",
          enabled: true,
        },
      ],
    });
    const errors = validateUserSnippetDraft(
      {
        id: "user-2",
        name: "Two",
        description: "",
        trigger: "alpha",
        body: "${1:x}${0}",
        enabled: true,
      },
      {
        takenTriggers: collectTakenTriggers(settings),
        takenIds: new Set(["user-1"]),
      },
    );
    expect(errors.some((entry) => entry.field === "trigger")).toBe(true);
  });
});
