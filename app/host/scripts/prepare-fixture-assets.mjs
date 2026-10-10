// Explicit source-test preparation, separate from the lean application build.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
execFileSync(process.execPath, [fileURLToPath(new URL('./package-assets.mjs', import.meta.url)), '--source-fixtures'], { stdio: 'inherit' });
import { packageClaudeAssets } from './claude-assets.mjs';
import { packageCursorAssets } from './cursor-assets.mjs';
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
packageClaudeAssets(dist);
packageCursorAssets(dist);
