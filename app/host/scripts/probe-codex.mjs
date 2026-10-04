import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const temporary = mkdtempSync(join(tmpdir(), 'specops-probe-build-'));
try {
 const path = join(temporary, 'probe.mjs');
 await build({ entryPoints: [resolve(dirname(fileURLToPath(import.meta.url)), '../src/codex/probe.ts')], outfile: path, bundle: true, platform: 'node', target: 'node24', format: 'esm' });
 await (await import(pathToFileURL(path))).probe();
} finally { rmSync(temporary, { recursive: true, force: true }); }
