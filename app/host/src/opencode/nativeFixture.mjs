#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
if (process.argv.includes("--version")) {
  console.log("1.17.4");
  process.exit(0);
}
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const authPath = join(process.env.XDG_DATA_HOME, "opencode", "auth.json");
const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
  stdio: "ignore",
});
writeFileSync(join(process.env.HOME, "fixture-child"), String(child.pid));
writeFileSync(join(process.env.HOME, "fixture-native"), String(process.pid));
const sessionsPath = join(process.env.HOME, "fixture-sessions.json");
const sessions = existsSync(sessionsPath)
  ? JSON.parse(readFileSync(sessionsPath, "utf8"))
  : {};
const save = () => writeFileSync(sessionsPath, JSON.stringify(sessions));
const streams = new Set();
let eventId = 0;
const pending = new Map();
const event = (type, properties) => {
  for (const res of streams)
    res.write(
      `data: ${JSON.stringify({ id: "event-" + ++eventId, type, properties })}\n\n`,
    );
};
const complete = (sessionID, body) => {
  const s = sessions[sessionID];
  const id = "assistant-" + body.messageID;
  const now = Date.now();
  const info = {
    id,
    sessionID,
    role: "assistant",
    parentID: body.messageID,
    time: { created: now, completed: now },
    tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
  };
  const part = {
    id: "text-" + id,
    sessionID,
    messageID: id,
    type: "text",
    text: "Native fixture answer",
    time: { start: now, end: now },
  };
  s.messages.push({ info, parts: [part] });
  save();
  event("message.updated", { info });
  event("message.part.updated", { sessionID, part, time: now });
  event("session.status", { sessionID, status: { type: "idle" } });
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  if (path.startsWith("/session"))
    appendFileSync(
      join(process.env.HOME, "fixture-requests.jsonl"),
      JSON.stringify({ method: req.method, path }) + "\n",
    );
  const expected = `Basic ${Buffer.from(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`;
  if (req.headers.authorization !== expected) {
    res.statusCode = 401;
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  if (path === "/event") {
    res.setHeader("Content-Type", "text/event-stream");
    res.write(": connected\n\n");
    streams.add(res);
    req.on("close", () => streams.delete(res));
    return;
  }
  if (path === "/global/health") {
    res.end(JSON.stringify({ healthy: true, version: "1.17.4" }));
    return;
  }
  if (req.url === "/provider") {
    res.end(
      JSON.stringify({
        all: [],
        default: {},
        connected: existsSync(authPath)
          ? Object.keys(JSON.parse(readFileSync(authPath, "utf8")))
          : [],
      }),
    );
    return;
  }
  if (req.url?.startsWith("/auth/")) {
    const provider = decodeURIComponent(req.url.slice(6));
    const current = existsSync(authPath)
      ? JSON.parse(readFileSync(authPath, "utf8"))
      : {};
    if (req.method === "PUT") {
      let body = "";
      for await (const chunk of req) body += chunk;
      current[provider] = JSON.parse(body);
    } else delete current[provider];
    writeFileSync(authPath, JSON.stringify(current));
    res.end("true");
    return;
  }
  if (path === "/config") {
    res.end(JSON.stringify({ model: "fixture/model", default_agent: "build" }));
    return;
  }
  if (path === "/config/providers") {
    res.end(JSON.stringify({ providers: [{ id: "fixture", name: "Fixture provider", models: { model: { id: "model", name: "Fixture model" } } }], default: { fixture: "model" } }));
    return;
  }
  if (path === "/agent") {
    res.end(JSON.stringify([{ name: "build", mode: "primary", hidden: false }]));
    return;
  }
  if (path === "/session" && req.method === "GET") { res.end(JSON.stringify(Object.values(sessions).map(s => s.info))); return; }
  if (["/skill", "/file/status", "/lsp", "/formatter"].includes(path)) { res.end("[]"); return; }
  if (path === "/command") { res.end(JSON.stringify([{ name: "review", description: "Review change", hints: ["path"], agent: "build" }])); return; }
  if (path === "/mcp") { res.end(JSON.stringify({ local: { status: "connected" } })); return; }
  if (path === "/mcp/local/connect" || path === "/mcp/local/disconnect") { res.end("true"); return; }
  if (path === "/session" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    const id = "ses-" + (Object.keys(sessions).length + 1);
    const info = {
      id,
      directory: url.searchParams.get("directory"),
      metadata: input.metadata,
      agent: input.agent,
      model: input.model,
      time: { created: Date.now(), updated: Date.now() },
    };
    sessions[id] = { info, messages: [] };
    save();
    res.end(JSON.stringify(info));
    return;
  }
  if (path === "/session/status") {
    res.end("{}");
    return;
  }
  const match = path.match(/^\/session\/([^/]+)(?:\/(.*))?$/);
  if (match) {
    const id = match[1],
      action = match[2];
    const s = sessions[id];
    if (!s) {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    if (!action) {
      if (req.method === "PATCH") {
        let data = "";
        for await (const chunk of req) data += chunk;
        const body = JSON.parse(data);
        s.info.metadata = body.metadata;
        save();
      }
      res.end(JSON.stringify(s.info));
      return;
    }
    if (action === "todo") { res.end(JSON.stringify([{ id: "task", content: "Review changes", status: "pending", priority: "high" }])); return; }
    if (action === "diff") { res.end(JSON.stringify([{ file: "src/main.ts", additions: 1, deletions: 0, before: "", after: "new code" }])); return; }
    if (action === "share") { if (req.method === "POST") s.info.share = { url: "https://example.com/s/fixture" }; else delete s.info.share; save(); res.end(JSON.stringify(s.info)); return; }
    if (action === "fork") { const child = "ses-" + (Object.keys(sessions).length + 1); sessions[child] = structuredClone(s); sessions[child].info.id = child; sessions[child].info.parentID = id; sessions[child].messages = sessions[child].messages.map(row => ({ info: { ...row.info, sessionID: child }, parts: row.parts.map(p => ({ ...p, sessionID: child })) })); save(); res.end(JSON.stringify(sessions[child].info)); return; }
    if (action === "revert") { let body = ""; for await (const chunk of req) body += chunk; s.info.revert = { messageID: JSON.parse(body).messageID }; save(); res.end(JSON.stringify(s.info)); return; }
    if (action === "unrevert") { delete s.info.revert; save(); res.end(JSON.stringify(s.info)); return; }
    if (action?.startsWith("message/")) { const row = s.messages.find(row => row.info.id === action.slice(8)); if (!row) { res.statusCode = 404; res.end("{}"); } else res.end(JSON.stringify(row)); return; }
    if (action === "message") {
      res.end(JSON.stringify(s.messages));
      return;
    }
    if (action === "abort") {
      if (s.ignoreAbort) return;
      const finish = () => {
        event("session.status", { sessionID: id, status: { type: "idle" } });
        res.end("true");
      };
      if (s.delayedAbort) setTimeout(finish, 180);
      else finish();
      return;
    }
    if (action === "prompt_async") {
      let data = "";
      for await (const chunk of req) data += chunk;
      const body = JSON.parse(data);
      s.messages.push({
        info: {
          id: body.messageID,
          sessionID: id,
          role: "user",
          time: { created: Date.now() },
        },
        parts: body.parts,
      });
      save();
      event("message.updated", {
        info: {
          id: "assistant-" + body.messageID,
          role: "assistant",
          sessionID: id,
          parentID: body.messageID,
          time: { created: Date.now() },
        },
      });
      const prompt = body.parts[0].text;
      s.ignoreAbort = prompt === "ignored-cancel";
      s.delayedAbort = prompt === "delayed-cancel";
      res.statusCode = 204;
      if (s.delayedAbort) setTimeout(() => res.end(), 150);
      else res.end();
      if (["cancel", "ignored-cancel", "delayed-cancel"].includes(prompt))
        return;
      if (prompt === "unknown") {
        event("new.native.kind", {
          sessionID: id,
          password: "contract-secret-canary",
        });
        event(undefined, { sessionID: id });
      }
      if (prompt === "permission" || prompt === "question") {
        const requestID = "interaction-" + body.messageID;
        pending.set(requestID, { id, body });
        event(prompt === "permission" ? "permission.asked" : "question.asked", {
          id: requestID,
          sessionID: id,
          tool: { messageID: "assistant-" + body.messageID, callID: "tool" },
          permission: "write",
          patterns: ["file"],
          questions: [
            {
              question: "Choose",
              header: "Selection",
              options: [{ label: "One", description: "First" }],
            },
          ],
        });
        return;
      }
      setTimeout(() => complete(id, body), 15);
      return;
    }
  }
  const reply = path.match(
    /^\/(permission|question)\/([^/]+)\/(reply|reject)$/,
  );
  if (reply) {
    const entry = pending.get(reply[2]);
    pending.delete(reply[2]);
    if (entry) complete(entry.id, entry.body);
    res.end("true");
    return;
  }
  res.statusCode = 404;
  res.end("{}");
});
server.listen(port, "127.0.0.1");
