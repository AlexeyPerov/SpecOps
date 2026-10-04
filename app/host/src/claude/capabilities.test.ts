import { afterEach, describe, expect, it } from "vitest";
import { ClaudeInteractions } from "./interactions";
import { ClaudeTurn } from "./turn";
import { ClaudeProcessOwner } from "./session";
import { claudePolicy, claudeQueryPolicy } from "./policy";
import { asNativeSessionId, asSpecOpsTurnId } from "../../../src/lib/session/ids";
const turns: ClaudeTurn[] = [];
afterEach(async () => { for (const t of turns.splice(0)) await t.stop(); });
function setup(timeout = 500) {
  let current = true, seq = 0;
  const t = new ClaudeTurn({native: {runtimeId: "claude", connectionProfileId: "profile-a", nativeSessionId: asNativeSessionId("session-a")}, turnId: asSpecOpsTurnId("turn-a"), workspaceRootPath: "/workspace", prompt: "fixture"}, "user-a", 4, "credential-canary", new ClaudeProcessOwner(), () => ++seq, () => current, x => x, 2000);
  turns.push(t);
  const interaction = new ClaudeInteractions(t, timeout);
  const events = t.events()[Symbol.asyncIterator]();
  const options = {signal: new AbortController().signal, requestId: "request-a", toolUseID: "tool-a"};
  return {t, interaction, options, events, stale: () => {current = false;}};
}
async function requested(events: AsyncIterator<any>) { await events.next(); return (await events.next()).value; }
describe("Claude native capabilities", () => {
  it("maps once approval with correlation and redacts private callback metadata", async () => {
    const {interaction, options, events} = setup();
    const response = interaction.canUseTool("Write", {content: "credential-canary", file_path: "file"}, {...options, title: "credential-canary"});
    const event = await requested(events);
    expect(event).toMatchObject({type: "permission.requested", nativeGeneration: 4, connectionProfileId: "profile-a", nativeSessionId: "session-a", turnId: "turn-a"});
    expect(JSON.stringify(event)).not.toContain("credential-canary");
    interaction.reply(event.request.permissionId, "permission", "once");
    expect(await response).toMatchObject({behavior: "allow", updatedInput: {content: "credential-canary"}, toolUseID: "tool-a"});
    expect(() => interaction.reply(event.request.permissionId, "permission", "once")).toThrow("expired");
    expect(await interaction.canUseTool("Write", {}, options)).toMatchObject({behavior: "deny"});
  });
  it.each(["userSettings", "projectSettings", "localSettings", "cliArg"])("never writes %s rules via always", async destination => {
    const {interaction, options, events} = setup();
    const response = interaction.canUseTool("Bash", {command: "ls"}, {...options, suggestions: [{type: "addRules", behavior: "allow", destination, rules: [{toolName: "Bash", ruleContent: "ls"}]}] as any});
    const event = await requested(events);
    expect(event.request.payload.allowAlways).toBe(false);
    expect(() => interaction.reply(event.request.permissionId, "permission", "always")).toThrow("unavailable");
    interaction.reply(event.request.permissionId, "permission", "reject");
    expect(await response).toMatchObject({behavior: "deny"});
  });
  it("returns only exact displayed native session suggestions and honors suppressAlways", async () => {
    const {interaction, options, events} = setup();
    const rules = [{type: "addRules", behavior: "allow", destination: "session", rules: [{toolName: "Bash", ruleContent: "ls"}]}] as const;
    const response = interaction.canUseTool("Bash", {command: "ls"}, {...options, suggestions: rules as any});
    const event = await requested(events);
    expect(event.request.payload.sessionRuleScope).toEqual(rules);
    interaction.reply(event.request.permissionId, "permission", "always");
    expect(await response).toMatchObject({updatedPermissions: rules});
    const second = interaction.canUseTool("Bash", {}, {...options, requestId: "next", suggestions: rules as any, suppressAlwaysAllowRule: true});
    const next = (await events.next()).value;
    expect(next.request.payload.allowAlways).toBe(false);
    interaction.reply(next.request.permissionId, "permission", "once");
    expect(await second).not.toHaveProperty("updatedPermissions");
  });
  it("handles sequential native questions, comma-separated multiselect and free text", async () => {
    const {interaction, options, events} = setup();
    const input = {questions: [{question: "Which?", options: [{label: "A"}, {label: "B"}], multiSelect: true}, {question: "__proto__", options: [{label: "C"}, {label: "D"}], multiSelect: false}]};
    const response = interaction.canUseTool("AskUserQuestion", input, options);
    const first = await requested(events);
    expect(first.request.payload).toMatchObject({multiSelect: true, allowFreeText: true});
    interaction.reply(first.request.questionId, "question", "A, B");
    const second = (await events.next()).value;
    expect(second.request.payload.multiSelect).toBe(false);
    interaction.reply(second.request.questionId, "question", "My custom answer");
    expect(await response).toMatchObject({behavior: "allow", updatedInput: {...input, answers: {"Which?": "A, B", ["__proto__"]: "My custom answer"}}});
  });
  it("rejects stale, wrong-kind and unsupported dialog responses", async () => {
    const {interaction, options, events, stale} = setup();
    const response = interaction.canUseTool("Write", {}, options);
    const event = await requested(events);
    expect(() => interaction.reply(event.request.permissionId, "question", "x")).toThrow();
    stale();
    expect(() => interaction.reply(event.request.permissionId, "permission", "once")).toThrow();
    expect(await interaction.onUserDialog({dialogKind: "future", payload: {}}, {signal: options.signal, requestId: "dialog"})).toEqual({behavior: "cancelled"});
    // The native callback signal aborts it even when the generation became stale.
    turns.at(-1)!.abort.abort();
    expect(await response).toMatchObject({behavior: "deny"});
  });
  it("fails closed on callback abort, turn stop, timeout and overlapping requests", async () => {
    const {interaction, options, events, t} = setup(20);
    const response = interaction.canUseTool("Write", {}, options);
    const event = await requested(events);
    expect(await interaction.canUseTool("Read", {}, {...options, requestId: "overlap"})).toMatchObject({behavior: "deny"});
    expect(await response).toMatchObject({behavior: "deny"});
    expect(() => interaction.reply(event.request.permissionId, "permission", "once")).toThrow();
    const pending = interaction.canUseTool("Read", {}, {...options, requestId: "stop"});
    await t.stop();
    expect(await pending).toMatchObject({behavior: "deny"});
  });
  it("rejects malformed/overcapacity input without leaking or opening a prompt", async () => {
    const {interaction, options} = setup();
    expect(await interaction.canUseTool("AskUserQuestion", {questions: [{question: "bad"}]}, options)).toMatchObject({behavior: "deny"});
    expect(await interaction.canUseTool("Write", {content: "x".repeat(65537)}, options)).toMatchObject({behavior: "deny"});
    expect(await interaction.canUseTool("Write", {}, {...options,requestId:"x".repeat(501)})).toMatchObject({behavior:"deny"});
  });
  it("validates native controls, distinct limits and native isolation before dispatch", () => {
    expect(claudeQueryPolicy({permissionMode: "acceptEdits", allowedTools: "Read", disallowedTools: "Write", maxTurns: 3, maxBudgetUsd: 0.5})).toMatchObject({permissionMode: "acceptEdits", allowedTools: ["Read"], disallowedTools: ["Write"], maxTurns: 3, maxBudgetUsd: .5, settingSources: [], strictMcpConfig: true, skills: []});
    for (const value of [{permissionMode: "auto"}, {permissionMode: "bypassPermissions"}, {maxTurns: 0}, {maxTurns: 1.5}, {maxBudgetUsd: 0}, {maxBudgetUsd: Infinity}, {allowedTools: "UnknownTool"}, {allowedTools: "Bash(*)"}, {allowedTools: "Read,Read"}, {allowedTools: "Read", disallowedTools: "Read"}, {toolSet: "none", allowedTools: "Read"}, {configScope: "workspace"}, {sandbox: "read-only"}, {writeCapability: "read-only"}]) expect(() => claudePolicy(value)).toThrow();
    expect(claudePolicy({permissionMode: "plan"}).writeCapability).toBe("possible");
    expect(claudePolicy({toolSet: "none"}).writeCapability).toBe("unknown");
  });
});
