// One native agent operation per isolated process; stdout is private framing.
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
const output = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write = () => true;
console.log = console.error = console.warn = () => {};
process.umask(0o077);
let agent, run, stopped = false, started = false, finished = false;
const emit = async (frame) => {
  const line = JSON.stringify(frame) + "\n";
  if (Buffer.byteLength(line) > 1048576) throw new Error("capacity");
  await new Promise((resolve, reject) => output(line, (e) => e ? reject(e) : resolve()));
};
let cleaning = Promise.resolve(), disposedAgent;
const cleanup = () => {
  cleaning = cleaning.catch(() => {}).then(async () => {
    if (run && run.status === "running") await run.cancel();
    if (agent && agent !== disposedAgent) { const current = agent; await current[Symbol.asyncDispose](); disposedAgent = current; }
  });
  return cleaning;
};
const stop = async () => { stopped = true; await cleanup(); };
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
// Bound input before readline allocates a complete frame.
let inputBytes = 0;
process.stdin.on("data", (chunk) => {
  inputBytes += chunk.length;
  if (inputBytes > 1048576) { void stop(); process.exit(2); }
});
lines.on("close", () => { if (!finished) void stop().catch(() => process.exit(2)); });
lines.on("line", (line) => {
  if (started) {
    if (line === '{"action":"cancel"}') void stop().catch(() => process.exit(2));
    else process.exit(2);
    return;
  }
  started = true;
  void main(line);
});
async function main(line) {
  try {
    const req = JSON.parse(line);
    const root = lstatSync(req.store);
    if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("store");
    const names = readdirSync(req.store);
    let total = 0;
    if (names.length > 8) throw new Error("store");
    for (const name of names) {
      const stat = lstatSync(join(req.store, name));
      total += stat.size;
      if (total > 67108864 || !["agents.ndjson", "runs.ndjson", "run_events.ndjson", "checkpoints.ndjson"].includes(name) || !stat.isFile() || stat.isSymbolicLink() || stat.size > 16777216 ||
          (process.platform !== "win32" && stat.mode & 0o077)) throw new Error("store");
    }
    const sdk = await import(pathToFileURL(req.sdk).href);
    const store = new sdk.JsonlLocalAgentStore(req.store);
    const options = {
      apiKey: req.key,
      ...(req.modelId ? { model: { id: req.modelId, params: req.binding.modelParams ?? [] } } : {}),
      mode: "agent", tools: req.binding.tools ?? [], mcpServers: {},
      local: { cwd: req.cwd, store, settingSources: [], sandboxOptions: {enabled: req.binding.sandbox !== "disabled"}, autoReview: false, enableAgentRetries: false },
    };
    if (stopped) throw new Error("cancelled");
    if (req.action === "create") {
      agent = await sdk.Agent.create(options);
      if (stopped) throw new Error("cancelled");
      const row = await store.agents.get({ agentId: agent.agentId });
      await store.agents.update({ agent: { ...row, sdkMetadata: { ...row.sdkMetadata, specopsBinding: req.binding } } });
      await emit({ type: "created", agentId: agent.agentId });
    } else {
      const row = await store.agents.get({ agentId: req.agentId });
      if (!row || row.cwd !== req.cwd || JSON.stringify(row.sdkMetadata?.specopsBinding) !== JSON.stringify(req.binding)) {
        await emit({ type: "failure", reason: row ? "binding" : "missing" });
        return;
      }
      // Explicit native resume never sends a previous prompt or resumes an expired run.
      agent = await sdk.Agent.resume(req.agentId, options);
      if (stopped) throw new Error("cancelled");
      if (req.action === "history") {
        let cursor, count = 0;
        do {
          const page = await store.runs.list({ filter: { agentIds: [req.agentId], limit: 100, cursor } });
          for (const nativeRun of page.items) {
            if (++count > 4096) throw new Error("capacity");
            await emit({ type: "historyRun", run: nativeRun });
            let offset, events = 0;
            do {
              const page = await store.runEvents.list({ runId: nativeRun.runId, afterOffset: offset, limit: 100 });
              for (const event of page.items) {
                if (++events > 4096) throw new Error("capacity");
                if (event.eventType === sdk.LOCAL_RUN_STREAM_EVENT_TYPE) {
                  const decoded = sdk.decodeLocalRunStreamEvent(event.payload);
                  const message = sdk.localRunStreamEventToSdkMessage(decoded);
                  if (message) await emit({ type: "historyEvent", runId: nativeRun.runId, seq: event.seq, createdAt: event.createdAt, message });
                }
              }
              offset = page.nextOffset;
            } while (offset);
          }
          cursor = page.nextCursor;
        } while (cursor);
        await emit({ type: "historyDone" });
      } else if (req.action === "send") {
        const all = await store.runs.list({ filter: { agentIds: [req.agentId], limit: 4097 } });
        if (all.nextCursor || all.items.some((r) => r.status === "running" || (r.status === "queued" && !(all.items.length === 1 && r.turnNumber === 1 && r.startedAt == null && r.requestId == null && r.latestCheckpointRef == null && row.status === "idle")))) throw new Error("active");
        run = await agent.send(req.prompt, { model: { id: req.modelId, params: req.binding.modelParams ?? [] }, mode: "agent" });
        if (stopped) { await run.cancel(); throw new Error("cancelled"); }
        if (!["stream", "wait", "cancel"].every((op) => run.supports(op))) throw new Error("unsupported");
        await emit({ type: "started", runId: run.id, agentId: run.agentId });
        for await (const message of run.stream()) {
          if (stopped) break;
          await emit({ type: "event", message });
        }
        const result = await run.wait();
        await emit({ type: "terminal", runId: run.id, status: stopped ? "cancelled" : result.status });
      } else throw new Error("unsupported");
    }
  } catch (error) {
    const reason = stopped ? "cancelled" : error?.name === "AuthenticationError" ? "auth-required" : error?.name === "RateLimitError" ? "quota" : "native";
    try { await emit({ type: "failure", reason }); } catch {}
  } finally {
    try { await cleanup(); } catch {}
    finished = true;
    lines.close();
    process.exit(0);
  }
}
