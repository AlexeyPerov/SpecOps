// Explicit no-account source package probe; never reads ambient provider credentials.
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { packageClaudeAssets } from "./claude-assets.mjs";
const root = mkdtempSync(join(tmpdir(), "specops-claude-package-"));
try {
  packageClaudeAssets(root);
  const home = join(root, "profile");
  mkdirSync(home, { mode: 0o700 });
  const bin = join(
    root,
    "claude",
    process.platform === "win32" ? "claude.exe" : "claude",
  );
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: home,
    XDG_CONFIG_HOME: home,
    DISABLE_AUTOUPDATER: "1",
  };
  const version = execFileSync(bin, ["--version"], {
    env,
    timeout: 10000,
    encoding: "utf8",
  }).trim();
  if (!version.startsWith("2.1.289 "))
    throw new Error("Unexpected native version");
  // A separate Node process imports the distributed SDK outside the checkout. No NODE_PATH,
  // no node_modules and no model call; only native control initialization is exercised.
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { pathToFileURL } from 'node:url';
    const { query } = await import(pathToFileURL(process.argv[1]).href);
    const abort = new AbortController();
    async function* input() { await new Promise(r => abort.signal.addEventListener('abort',r,{once:true})); }
    const q = query({prompt:input(), options:{env:process.env,cwd:process.env.HOME,pathToClaudeCodeExecutable:process.argv[2],abortController:abort,settingSources:[],tools:[],persistSession:false}});
    const timer = setTimeout(() => { abort.abort(); q.close(); process.exitCode=1; },10000);
    try { const models = await q.supportedModels(); if (!models.length) throw new Error('Empty native catalog'); console.log(JSON.stringify({models:models.length})); }
    finally { clearTimeout(timer); abort.abort(); q.close(); }
  `,
      join(root, "claude", "sdk.mjs"),
      bin,
    ],
    { cwd: root, env, timeout: 15000, encoding: "utf8", maxBuffer: 4096 },
  );
  const manifest = JSON.parse(
    readFileSync(join(root, "claude", "assets.json"), "utf8"),
  );
  console.log(
    JSON.stringify({
      sdkVersion: manifest.sdkVersion,
      nativeVersion: version,
      platform: manifest.platform,
      arch: manifest.arch,
      isolatedPackage: true,
      ...JSON.parse(output),
    }),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
