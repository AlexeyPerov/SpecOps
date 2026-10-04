// Private one-shot native SDK control worker. No vendor output enters host framing.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
const output = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;
process.stderr.write = () => true;
console.log = console.error = console.warn = () => {};
process.umask(0o077);
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 16384) process.exit(2);
}
let result;
try {
  const request = JSON.parse(input);
  const sdk = await import(pathToFileURL(request.sdk).href);
  if (request.action === "probe") {
    const root = mkdtempSync(join(process.env.HOME, "native", "probe-"));
    const store = new sdk.JsonlLocalAgentStore(root);
    let agent, resumed, id;
    try {
      agent = await sdk.Agent.create({
        apiKey: "specops-no-account-probe",
        tools: [],
        local: {
          cwd: process.env.HOME,
          store,
          settingSources: [],
          enableAgentRetries: false,
        },
      });
      id = agent.agentId;
      await agent[Symbol.asyncDispose]();
      agent = undefined;
      resumed = await sdk.Agent.resume(id, {
        apiKey: "specops-no-account-probe",
        tools: [],
        local: {
          cwd: process.env.HOME,
          store,
          settingSources: [],
          enableAgentRetries: false,
        },
      });
    } finally {
      const cleanup = await Promise.allSettled([
        Promise.resolve().then(() => resumed?.[Symbol.asyncDispose]()),
        Promise.resolve().then(() => agent?.[Symbol.asyncDispose]()),
      ]);
      rmSync(root, { recursive: true, force: true });
      if (cleanup.some((item) => item.status === "rejected"))
        throw new Error("Native agent cleanup failed");
    }
    result = {
      ok: true,
      probe: {
        durableAgent: true,
        nativeId: id.startsWith("agent-"),
        store: "jsonl",
        node: process.version,
      },
    };
  } else if (
    request.action === "read" &&
    typeof request.key === "string" &&
    request.key
  ) {
    // Native account and model catalog APIs only. These do not execute a model turn.
    await sdk.Cursor.me({ apiKey: request.key });
    const models = await sdk.Cursor.models.list({ apiKey: request.key });
    if (
      models.length > 1000 ||
      Buffer.byteLength(JSON.stringify(models)) > 1048576
    )
      throw new Error("capacity");
    result = { ok: true, models };
  } else throw new Error("unsupported");
} catch (error) {
  const auth =
    error?.name === "AuthenticationError" ||
    error?.status === 401 ||
    error?.status === 403 ||
    error?.code === "unauthenticated" ||
    error?.code === 16;
  result = { ok: false, reason: auth ? "auth-required" : "offline" };
}
output(JSON.stringify(result) + "\n", () => process.exit(0));
