// Package the tested Node executable with an allowlisted identity manifest.
import { copyFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, resolve } from 'node:path';
const hostDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.env.SPECOPS_NODE_SOURCE ?? process.execPath;
if (!isAbsolute(source)) throw new Error('SPECOPS_NODE_SOURCE must be absolute');
const version = execFileSync(source, ['--version'], { encoding: 'utf8' }).trim();
if (!/^v24\./.test(version)) throw new Error('Packaging requires the supported Node 24 runtime');
const identity = JSON.parse(execFileSync(source, ['-p', 'JSON.stringify({platform:process.platform,arch:process.arch})'], { encoding: 'utf8' }));
if (identity.platform !== process.platform || identity.arch !== process.arch) throw new Error('Node target differs from build host; explicit cross-target packaging is unavailable');
const resources = resolve(hostDir, '../src-tauri/resources/agent-host');
mkdirSync(resources, { recursive: true });
const target = join(resources, process.platform === 'win32' ? 'node.exe' : 'node');
if (process.platform === 'darwin') {
  const dependencies = execFileSync('/usr/bin/otool', ['-L', source], { encoding: 'utf8' }).split('\n').slice(1).map(line => line.trim().split(' ')[0]).filter(Boolean);
  if (dependencies.some(path => !path.startsWith('/usr/lib/') && !path.startsWith('/System/Library/'))) throw new Error('Packaged Node must depend only on system libraries');
}
const licenseSource = process.env.SPECOPS_NODE_LICENSE ?? resolve(dirname(source), '../LICENSE');
if (!isAbsolute(licenseSource)) throw new Error('Node license source must be absolute');
const license = readFileSync(licenseSource);
if (!license.toString('utf8').includes('Node.js')) throw new Error('Node distribution license is required');
copyFileSync(source, target); chmodSync(target, 0o755);
writeFileSync(join(resources, 'NODE-LICENSE.txt'), license);
const host = readFileSync(join(hostDir, 'dist/index.js'));
writeFileSync(join(resources, 'manifest.json'), JSON.stringify({ nodeVersion: version, platform: identity.platform, arch: identity.arch, nodeSha256: createHash('sha256').update(readFileSync(target)).digest('hex'), hostSha256: createHash('sha256').update(host).digest('hex') }, null, 2) + '\n');
