// CI-only assembly of the pinned client graph; never run by the installer.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
export async function packageOpencodeAssets(destination) {
  const entry = fileURLToPath(import.meta.resolve('@opencode-ai/sdk/v2/client'));
  let root = dirname(entry);
  root = dirname(dirname(root));
  const meta = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (meta.version !== '1.17.4') throw new Error('Unsupported SDK pin');
  mkdirSync(destination, { recursive: true });
  await build({entryPoints:[entry], bundle:true, platform:'node', format:'esm', target:'node24', outfile:join(destination,'sdk.mjs')});
  copyFileSync(join(root,'package.json'), join(destination,'sdk-package.json'));
}
if (process.argv[2]) await packageOpencodeAssets(process.argv[2]);
