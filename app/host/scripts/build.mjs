// Bundles the Agent Host into a single self-contained ESM file at dist/index.js.
// Version metadata is injected at build time (HOST_VERSION from package.json,
// git sha, build timestamp) so the packaged artifact reports deterministic
// identity without the WebView importing any host code.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const hostDir = path.resolve(scriptsDir, "..");
const pkg = JSON.parse(readFileSync(path.join(hostDir, "package.json"), "utf8"));

let gitSha = "unknown";
try {
  gitSha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
} catch {
  // git unavailable (e.g. packed tarball) — keep the deterministic fallback.
}

const buildTime = new Date().toISOString();

await build({
  entryPoints: [path.join(hostDir, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: path.join(hostDir, "dist/index.js"),
  banner: { js: "#!/usr/bin/env node" },
  // Node keeps its real __dirname/__filename for ESM only via import.meta;
  // the host does not rely on them, so leave platform node defaults.
  define: {
    __HOST_VERSION__: JSON.stringify(pkg.version),
    __BUILD_GIT__: JSON.stringify(gitSha),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  logLevel: "info",
});

console.log(`agent-host ${pkg.version} (git ${gitSha}) built at ${buildTime}`);
