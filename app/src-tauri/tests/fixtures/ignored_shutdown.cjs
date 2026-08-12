// Fixture: a minimal JSON-RPC-over-stdio responder that negotiates initialize
// then deliberately ignores `shutdown` (keeps running). Used by the supervisor
// suite to prove a hung/cooperative-timeout shutdown is resolved by forced
// process-group kill within a bounded window. Optional argv[2] toggles noisy
// stderr to also exercise the bounded stderr drainer.
const noisy = process.argv[2] === "noisy";
if (noisy) {
  // Write far more than the drainer's line/byte caps; it must bound memory and
  // never block the process or panic.
  setInterval(() => {
    for (let i = 0; i < 50; i++) {
      process.stderr.write("noise " + "x".repeat(2000) + "\n");
    }
  }, 5);
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
    }
    // `shutdown` is intentionally ignored to exercise forced kill.
  }
});
