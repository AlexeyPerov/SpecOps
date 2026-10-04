import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { CursorSessionDriver, CursorOperation, CursorFrame } from "./session";
/** Deterministic native contract fixture. Never invokes model inference. */
export class CursorFixtureDriver implements CursorSessionDriver {
  calls: CursorOperation[] = [];
  fault?: "missing" | "disconnect" | "quota" | "route" | "oversize" | "diagnostics";
  constructor(readonly path: string) {}
  async *operation(req: CursorOperation, signal: AbortSignal): AsyncIterable<CursorFrame> {
    this.calls.push(req);
    const db = existsSync(this.path) ? JSON.parse(readFileSync(this.path, "utf8")) : {};
    if (req.action === "create") {
      const agentId = "agent-" + randomUUID();
      db[agentId] = { binding: req.binding, runs: [] };
      writeFileSync(this.path, JSON.stringify(db));
      yield { type: "created", agentId }; return;
    }
    const agent = db[req.agentId!];
    if (!agent || this.fault === "missing") { yield { type: "failure", reason: "missing" }; return; }
    if (JSON.stringify(agent.binding) !== JSON.stringify(req.binding)) throw new Error("binding");
    if (req.action === "history") {
      for (const entry of agent.runs) {
        yield { type: "historyRun", run: entry.run };
        for (const [seq, message] of entry.messages.entries()) yield { type: "historyEvent", runId: entry.run.runId, seq: seq + 1, createdAt: entry.run.createdAt, message };
      }
      yield { type: "historyDone" }; return;
    }
    if (signal.aborted) return;
    const runId = "run-" + randomUUID(), native = { agent_id: req.agentId, run_id: runId };
    const entry = { run: { agentId: req.agentId, runId, createdAt: Date.now(), status: "running" }, messages: [{ type: "user", ...native, message: { role: "user", content: [{ type: "text", text: req.prompt }] } }] };
    agent.runs.push(entry); writeFileSync(this.path, JSON.stringify(db));
    yield { type: "started", agentId: req.agentId, runId };
    if (this.fault === "disconnect") return;
    if (this.fault === "quota") { yield { type: "failure", reason: "quota" }; return; }
    if (req.prompt === "cancel") await new Promise<void>((resolve) => { if (signal.aborted) resolve(); else signal.addEventListener("abort", () => resolve(), { once: true }); });
    const text = req.prompt === "secret" ? "Native " + req.key + " answer " : "Native fixture answer ";
    const messages: any[] = [
      { type: "thinking", ...native, text: "Native reasoning " },
      { type: "assistant", ...native, message: { role: "assistant", content: [{ type: "text", text: text.slice(0, 12) }] } },
      { type: "assistant", ...native, message: { role: "assistant", content: [{ type: "text", text: text.slice(12) }] } },
      { type: "tool_call", ...native, call_id: "tool-" + req.key, name: "NativeTool", status: "running", args: { [req.key]: req.key } },
      { type: "tool_call", ...native, call_id: "tool-" + req.key, name: "NativeTool", status: "completed", result: { text: req.key } },
      { type: "usage", ...native, usage: { inputTokens: 5, outputTokens: 7, cacheReadTokens: 1, cacheWriteTokens: 2, reasoningTokens: 3, totalTokens: 12 } },
      { type: "future-native", ...native, value: req.key },
    ];
    if (this.fault === "diagnostics") messages.push({ type: "assistant", ...native, message: {} });
    if (this.fault === "route") messages[0].agent_id = "agent-other";
    if (this.fault === "oversize") messages[0].text = "x".repeat(1048577);
    for (const message of messages) {
      if (signal.aborted) break;
      entry.messages.push(message); writeFileSync(this.path, JSON.stringify(db));
      yield { type: "event", message };
    }
    entry.run.status = signal.aborted ? "cancelled" : "finished";
    writeFileSync(this.path, JSON.stringify(db));
    yield { type: "terminal", runId, status: entry.run.status };
  }
}
