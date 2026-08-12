// Fixture: negotiates initialize and spawns a long-lived grandchild that stays
// in the host's process group (NOT detached). The grandchild's pid is written to
// the file path passed as argv[2]. On `shutdown` the fixture exits without
// cleaning up its child, so the supervisor must reap the grandchild via
// process-group kill — proving no orphan remains.
const fs = require("fs");
const cp = require("child_process");

const pidfile = process.argv[2];

// Spawn a child that stays alive. No `detached` → inherits the host's process
// group, so killpg(hostPid) reaches it.
const grandchild = cp.spawn(process.argv0, ["-e", "setInterval(()=>{}, 1000);"], {
  stdio: "ignore",
});
grandchild.unref();
if (pidfile) {
  fs.writeFileSync(pidfile, String(grandchild.pid));
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.method === "initialize") {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: 1,
            server: { name: "fixture", build: { hostVersion: "fixture" }, runtimes: [] },
          },
        }) + "\n",
      );
    } else if (msg.method === "shutdown") {
      // Exit promptly but leave the grandchild orphaned.
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }) + "\n");
      process.exit(0);
    }
  }
});
