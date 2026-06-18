import { describe, expect, it } from "vitest";
import type { OpencodeConfigDocument, OpencodePermissionRule } from "./workspaceAgentBackend";
import {
  addPermissionRule,
  agentConfigEntryToRaw,
  buildPermissionMap,
  commandConfigEntryToRaw,
  getConfigAgents,
  getConfigAutoupdate,
  getConfigCommands,
  getConfigCompaction,
  getConfigDefaultAgent,
  getConfigExperimental,
  getConfigInstructions,
  getConfigModel,
  getConfigPermissionRules,
  getConfigShare,
  getConfigSkills,
  getConfigSmallModel,
  getConfigSnapshot,
  getConfigToolOutput,
  getConfigUsername,
  getGlobalPermissionAction,
  isPermissionGlobalAction,
  parseConfigJson,
  removeConfigAgent,
  removeConfigCommand,
  removePermissionRule,
  serializeConfigJson,
  setConfigAgent,
  setConfigAutoupdate,
  setConfigCommand,
  setConfigCompaction,
  setConfigDefaultAgent,
  setConfigExperimental,
  setConfigInstructions,
  setConfigModel,
  setConfigPermission,
  setConfigShare,
  setConfigSkills,
  setConfigSmallModel,
  setConfigSnapshot,
  setConfigToolOutput,
  setConfigUsername,
  sortConfigKeys,
  updatePermissionRule,
} from "./opencodeConfig";

describe("opencodeConfig — top-level getters", () => {
  it("reads scalar fields with fallbacks for missing/wrong types", () => {
    const doc: OpencodeConfigDocument = {};
    expect(getConfigModel(doc)).toBe("");
    expect(getConfigSmallModel(doc)).toBe("");
    expect(getConfigDefaultAgent(doc)).toBe("");
    expect(getConfigUsername(doc)).toBe("");
    expect(getConfigShare(doc)).toBe("manual");
    expect(getConfigAutoupdate(doc)).toBe(true);
    expect(getConfigSnapshot(doc)).toBe(false);
    expect(getConfigInstructions(doc)).toEqual([]);
  });

  it("reads present scalar fields", () => {
    const doc: OpencodeConfigDocument = {
      model: "anthropic/claude",
      small_model: "openai/gpt-mini",
      default_agent: "build",
      username: "alice",
      share: "auto",
      autoupdate: "notify",
      snapshot: true,
    };
    expect(getConfigModel(doc)).toBe("anthropic/claude");
    expect(getConfigSmallModel(doc)).toBe("openai/gpt-mini");
    expect(getConfigDefaultAgent(doc)).toBe("build");
    expect(getConfigUsername(doc)).toBe("alice");
    expect(getConfigShare(doc)).toBe("auto");
    expect(getConfigAutoupdate(doc)).toBe("notify");
    expect(getConfigSnapshot(doc)).toBe(true);
  });

  it("coerces boolean autoupdate", () => {
    expect(getConfigAutoupdate({ autoupdate: false })).toBe(false);
    expect(getConfigAutoupdate({ autoupdate: true })).toBe(true);
    expect(getConfigAutoupdate({ autoupdate: "notify" })).toBe("notify");
    expect(getConfigAutoupdate({ autoupdate: "garbage" })).toBe(true);
  });

  it("reads instructions as a filtered string array", () => {
    expect(getConfigInstructions({ instructions: ["AGENTS.md", "OTHER.md"] })).toEqual([
      "AGENTS.md",
      "OTHER.md",
    ]);
    // Non-string entries are dropped.
    expect(getConfigInstructions({ instructions: ["a", 1, null, "b"] })).toEqual(["a", "b"]);
  });

  it("reads skills paths + urls", () => {
    expect(getConfigSkills({})).toEqual({ paths: [], urls: [] });
    expect(
      getConfigSkills({
        skills: { paths: ["./skills"], urls: ["https://x"] },
      }),
    ).toEqual({ paths: ["./skills"], urls: ["https://x"] });
  });

  it("reads tool_output numeric fields", () => {
    expect(getConfigToolOutput({})).toEqual({ maxLines: undefined, maxBytes: undefined });
    expect(
      getConfigToolOutput({ tool_output: { max_lines: 100, max_bytes: 4096 } }),
    ).toEqual({ maxLines: 100, maxBytes: 4096 });
  });

  it("reads compaction with defaults", () => {
    expect(getConfigCompaction({})).toEqual({
      auto: true,
      prune: false,
      tailTurns: undefined,
      preserveRecentTokens: undefined,
      reserved: undefined,
    });
    expect(
      getConfigCompaction({
        compaction: { auto: false, prune: true, tail_turns: 4, reserved: 1000 },
      }),
    ).toEqual({
      auto: false,
      prune: true,
      tailTurns: 4,
      preserveRecentTokens: undefined,
      reserved: 1000,
    });
  });

  it("reads experimental flags with defaults", () => {
    expect(getConfigExperimental({})).toEqual({
      disablePasteSummary: false,
      batchTool: false,
      openTelemetry: false,
      continueLoopOnDeny: false,
      primaryTools: [],
      mcpTimeout: undefined,
    });
    expect(
      getConfigExperimental({
        experimental: {
          batch_tool: true,
          openTelemetry: true,
          disable_paste_summary: true,
          continue_loop_on_deny: true,
          primary_tools: ["read", "edit"],
          mcp_timeout: 5000,
        },
      }),
    ).toEqual({
      disablePasteSummary: true,
      batchTool: true,
      openTelemetry: true,
      continueLoopOnDeny: true,
      primaryTools: ["read", "edit"],
      mcpTimeout: 5000,
    });
  });
});

describe("opencodeConfig — setters", () => {
  it("sets and trims scalar string fields, dropping blank values", () => {
    const doc: OpencodeConfigDocument = {};
    expect(setConfigModel(doc, "  anthropic/x  ")).toEqual({ model: "anthropic/x" });
    expect(setConfigModel({ model: "x" }, "   ")).toEqual({});
    expect(setConfigUsername({}, "alice")).toEqual({ username: "alice" });
    expect(setConfigSmallModel({}, "m")).toEqual({ small_model: "m" });
    expect(setConfigDefaultAgent({}, "build")).toEqual({ default_agent: "build" });
  });

  it("setters return a new object (immutability)", () => {
    const doc: OpencodeConfigDocument = { model: "a" };
    const next = setConfigModel(doc, "b");
    expect(doc.model).toBe("a");
    expect(next.model).toBe("b");
  });

  it("sets share and autoupdate", () => {
    expect(setConfigShare({}, "disabled")).toEqual({ share: "disabled" });
    expect(setConfigAutoupdate({}, false)).toEqual({ autoupdate: false });
    expect(setConfigAutoupdate({}, "notify")).toEqual({ autoupdate: "notify" });
  });

  it("sets snapshot", () => {
    expect(setConfigSnapshot({}, true)).toEqual({ snapshot: true });
  });

  it("sets instructions, trimming and dropping blanks", () => {
    expect(setConfigInstructions({}, ["  AGENTS.md  ", "", "  ", "OTHER.md"])).toEqual({
      instructions: ["AGENTS.md", "OTHER.md"],
    });
    expect(setConfigInstructions({ instructions: ["a"] }, ["", "  "])).toEqual({});
  });

  it("sets skills and drops the key when empty", () => {
    expect(setConfigSkills({}, { paths: ["./s"], urls: ["https://u"] })).toEqual({
      skills: { paths: ["./s"], urls: ["https://u"] },
    });
    expect(setConfigSkills({ skills: { paths: ["x"] } }, { paths: [], urls: [] })).toEqual({});
  });

  it("sets tool_output and drops the key when empty", () => {
    expect(setConfigToolOutput({}, { maxLines: 10, maxBytes: undefined })).toEqual({
      tool_output: { max_lines: 10 },
    });
    expect(setConfigToolOutput({ tool_output: { max_lines: 1 } }, { maxLines: undefined, maxBytes: undefined })).toEqual({});
  });

  it("sets compaction always writing auto + prune", () => {
    expect(setConfigCompaction({}, {
      auto: true,
      prune: false,
      tailTurns: undefined,
      preserveRecentTokens: undefined,
      reserved: undefined,
    })).toEqual({ compaction: { auto: true, prune: false } });
  });

  it("sets experimental with all boolean flags", () => {
    const next = setConfigExperimental({}, {
      disablePasteSummary: false,
      batchTool: true,
      openTelemetry: false,
      continueLoopOnDeny: false,
      primaryTools: [],
      mcpTimeout: undefined,
    });
    expect(next.experimental).toMatchObject({ batch_tool: true, disable_paste_summary: false });
  });
});

describe("opencodeConfig — agents", () => {
  it("reads the agent map as typed entries", () => {
    const doc: OpencodeConfigDocument = {
      agent: {
        build: { model: "anthropic/x", mode: "primary", description: "main" },
        explore: { prompt: "explore", mode: "subagent", top_p: 0.5, max_steps: 3 },
      },
    };
    const agents = getConfigAgents(doc);
    expect(Object.keys(agents).sort()).toEqual(["build", "explore"]);
    expect(agents.build).toEqual({
      model: "anthropic/x",
      mode: "primary",
      description: "main",
    });
    expect(agents.explore).toEqual({
      prompt: "explore",
      mode: "subagent",
      topP: 0.5,
      maxSteps: 3,
    });
  });

  it("round-trips an agent entry through toRaw", () => {
    const raw = agentConfigEntryToRaw({
      model: "m",
      topP: 0.5,
      maxSteps: 3,
      mode: "primary",
      permission: "allow",
    });
    expect(raw).toEqual({
      model: "m",
      top_p: 0.5,
      max_steps: 3,
      mode: "primary",
      permission: "allow",
    });
  });

  it("adds/updates and removes agents", () => {
    let doc: OpencodeConfigDocument = {};
    doc = setConfigAgent(doc, "build", { mode: "primary", model: "m" });
    expect(doc.agent).toEqual({ build: { mode: "primary", model: "m" } });
    doc = setConfigAgent(doc, "build", { mode: "all" });
    expect((doc.agent as Record<string, unknown>).build).toEqual({ mode: "all" });
    doc = removeConfigAgent(doc, "build");
    expect(doc).toEqual({});
  });

  it("removing a non-existent agent is a no-op", () => {
    const doc: OpencodeConfigDocument = { agent: { a: { mode: "all" } } };
    expect(removeConfigAgent(doc, "missing")).toBe(doc);
  });

  it("drops an empty agent map on remove", () => {
    let doc: OpencodeConfigDocument = { agent: { solo: { mode: "all" } } };
    doc = removeConfigAgent(doc, "solo");
    expect(doc).toEqual({});
  });

  it("ignores blank names on set", () => {
    const doc: OpencodeConfigDocument = {};
    expect(setConfigAgent(doc, "   ", { mode: "all" })).toBe(doc);
  });
});

describe("opencodeConfig — commands", () => {
  it("reads the command map, requiring template", () => {
    const doc: OpencodeConfigDocument = {
      command: {
        review: { template: "Review", description: "d", agent: "a", subtask: true },
        broken: { description: "no template" },
      },
    };
    const commands = getConfigCommands(doc);
    expect(Object.keys(commands)).toEqual(["review"]);
    expect(commands.review).toEqual({
      template: "Review",
      description: "d",
      agent: "a",
      subtask: true,
    });
  });

  it("round-trips a command entry through toRaw", () => {
    expect(commandConfigEntryToRaw({ template: "T", subtask: true })).toEqual({
      template: "T",
      subtask: true,
    });
  });

  it("adds and removes commands", () => {
    let doc: OpencodeConfigDocument = {};
    doc = setConfigCommand(doc, "review", { template: "Review" });
    expect(doc.command).toEqual({ review: { template: "Review" } });
    doc = removeConfigCommand(doc, "review");
    expect(doc).toEqual({});
  });
});

describe("opencodeConfig — permission rules", () => {
  it("detects a global action permission", () => {
    expect(isPermissionGlobalAction("allow")).toBe(true);
    expect(isPermissionGlobalAction("ask")).toBe(true);
    expect(isPermissionGlobalAction({ bash: "allow" })).toBe(false);
    expect(isPermissionGlobalAction(undefined)).toBe(false);
  });

  it("reads the global default action", () => {
    expect(getGlobalPermissionAction({ permission: "deny" })).toBe("deny");
    expect(getGlobalPermissionAction({})).toBe("ask");
    expect(getGlobalPermissionAction({ permission: { bash: "allow" } })).toBe("ask");
  });

  it("extracts per-pattern rules from the permission map", () => {
    const doc: OpencodeConfigDocument = {
      permission: {
        bash: { "rm -rf": "deny", "ls": "allow" },
        edit: "allow",
        read: { "src/**": "ask" },
      },
    };
    const rules = getConfigPermissionRules(doc).sort((a, b) =>
      `${a.permission}:${a.pattern}`.localeCompare(`${b.permission}:${b.pattern}`),
    );
    expect(rules).toEqual([
      { permission: "bash", pattern: "ls", action: "allow" },
      { permission: "bash", pattern: "rm -rf", action: "deny" },
      { permission: "read", pattern: "src/**", action: "ask" },
    ]);
  });

  it("returns no rules for a global action or undefined", () => {
    expect(getConfigPermissionRules({ permission: "allow" })).toEqual([]);
    expect(getConfigPermissionRules({})).toEqual([]);
  });

  it("builds a permission map grouped by tool", () => {
    const map = buildPermissionMap([
      { permission: "bash", pattern: "rm", action: "deny" },
      { permission: "bash", pattern: "ls", action: "allow" },
      { permission: "edit", pattern: "src/**", action: "ask" },
    ]);
    expect(map).toEqual({
      bash: { rm: "deny", ls: "allow" },
      edit: { "src/**": "ask" },
    });
  });

  it("returns undefined for an empty rule list", () => {
    expect(buildPermissionMap([])).toBeUndefined();
  });

  it("drops rules with blank tool/pattern or invalid action", () => {
    const map = buildPermissionMap([
      { permission: "", pattern: "x", action: "allow" },
      { permission: "bash", pattern: "", action: "allow" },
      { permission: "bash", pattern: "ls", action: "maybe" as never },
    ]);
    expect(map).toBeUndefined();
  });

  it("setConfigPermission sets, updates, and removes the key", () => {
    let doc: OpencodeConfigDocument = {};
    doc = setConfigPermission(doc, "ask");
    expect(doc.permission).toBe("ask");
    doc = setConfigPermission(doc, undefined);
    expect(doc).toEqual({});
    doc = setConfigPermission(doc, { bash: { ls: "allow" } });
    expect(doc.permission).toEqual({ bash: { ls: "allow" } });
    doc = setConfigPermission(doc, undefined);
    expect("permission" in doc).toBe(false);
  });

  it("add/update/remove permission rules return new arrays", () => {
    const base: OpencodePermissionRule[] = [
      { permission: "bash", pattern: "ls", action: "allow" },
    ];
    expect(addPermissionRule(base)).toHaveLength(2);
    expect(updatePermissionRule(base, 0, { action: "deny" })[0]).toEqual({
      permission: "bash",
      pattern: "ls",
      action: "deny",
    });
    expect(updatePermissionRule(base, 5, { action: "deny" })).toBe(base);
    expect(removePermissionRule(base, 0)).toEqual([]);
    expect(removePermissionRule(base, 5)).toBe(base);
  });
});

describe("opencodeConfig — JSON serialization", () => {
  it("sorts keys with $schema first", () => {
    const doc: OpencodeConfigDocument = { zebra: 1, model: "m", $schema: "url" };
    expect(Object.keys(sortConfigKeys(doc))).toEqual(["$schema", "model", "zebra"]);
  });

  it("serialize + parse round-trips a config document", () => {
    const doc: OpencodeConfigDocument = { model: "m", agent: { build: { mode: "all" } } };
    const parsed = parseConfigJson(serializeConfigJson(doc));
    expect(parsed).toEqual(doc);
  });

  it("parse rejects non-object top-level values", () => {
    expect(() => parseConfigJson("[]")).toThrow(/object/i);
    expect(() => parseConfigJson("null")).toThrow(/object/i);
    expect(() => parseConfigJson('"string"')).toThrow(/object/i);
  });

  it("parse rethrows on invalid JSON", () => {
    expect(() => parseConfigJson("{not json")).toThrow();
  });
});
