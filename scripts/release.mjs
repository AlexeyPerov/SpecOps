#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'app/package.json',
  'app/package-lock.json',
  'app/src-tauri/tauri.conf.json',
  'app/src-tauri/Cargo.toml',
  'app/src-tauri/Cargo.lock',
];
const help = `Usage: node scripts/release.mjs <command>

  bump [patch|minor|major|X.Y.Z]  Update versions and changelog, then commit on master
  build                          Push master and its version tag to start GitHub installers
  build --local [Tauri options]   Build desktop bundles locally without tagging
  help                           Show this help

bump defaults to patch. build publishes through the existing Release workflow.
Run from any directory; Git operations require a clean checkout on master.`;

function git(args, inherit = false) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  })?.trim();
}

function requireCleanMaster() {
  if (git(['branch', '--show-current']) !== 'master') {
    throw new Error('Switch to master before running this command.');
  }
  if (git(['status', '--porcelain']).length) {
    throw new Error('Commit or stash all working-tree and staged changes first.');
  }
}

function versionState() {
  const texts = new Map(files.map(file => [file, readFileSync(resolve(root, file), 'utf8')]));
  const pkg = JSON.parse(texts.get(files[0]));
  const lock = JSON.parse(texts.get(files[1]));
  const config = JSON.parse(texts.get(files[2]));
  const manifest = texts.get(files[3]).match(/(\[package\][\s\S]*?^version\s*=\s*")([^"\n]+)(")/m);
  const cargoLock = texts.get(files[4]).match(/(\[\[package\]\]\r?\nname = "spec-ops"\r?\nversion = ")([^"\n]+)(")/);
  const versions = [pkg.version, lock.version, lock.packages?.['']?.version, config.version, manifest?.[2], cargoLock?.[2]];
  if (!versions.every(version => version === pkg.version) || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    throw new Error('Expected matching X.Y.Z versions in package, Tauri, Cargo and lockfiles.');
  }
  return { texts, pkg, lock, config, version: pkg.version, manifest, cargoLock };
}

function nextVersion(current, requested) {
  const parts = current.split('.').map(Number);
  const previous = [...parts];
  const index = ['major', 'minor', 'patch'].indexOf(requested);
  let next = requested;
  if (index !== -1) {
    parts[index]++;
    for (let i = index + 1; i < parts.length; i++) parts[i] = 0;
    next = parts.join('.');
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(next)) {
    throw new Error('Use patch, minor, major, or a version such as 0.3.0.');
  }
  const target = next.split('.').map(Number);
  if (!target.every(Number.isSafeInteger)) throw new Error('Version components are too large.');
  const firstDifference = target.findIndex((value, i) => value !== previous[i]);
  if (firstDifference === -1 || target[firstDifference] < previous[firstDifference]) {
    throw new Error(`New version must be greater than ${current}.`);
  }
  return next;
}

function timestamp() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Volgograd', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} MSK`;
}

function bump(requested) {
  requireCleanMaster();
  const state = versionState();
  const next = nextVersion(state.version, requested);
  const updates = new Map(state.texts);
  state.pkg.version = state.lock.version = state.lock.packages[''].version = next;
  updates.set(files[0], JSON.stringify(state.pkg, null, 2) + '\n');
  updates.set(files[1], JSON.stringify(state.lock, null, 2) + '\n');
  // Keep the Tauri configuration's compact objects intact.
  updates.set(files[2], state.texts.get(files[2]).replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`));
  updates.set(files[3], state.texts.get(files[3]).replace(state.manifest[0], `${state.manifest[1]}${next}${state.manifest[3]}`));
  updates.set(files[4], state.texts.get(files[4]).replace(state.cargoLock[0], `${state.cargoLock[1]}${next}${state.cargoLock[3]}`));
  const changelog = 'specs/changelog.md';
  const original = readFileSync(resolve(root, changelog), 'utf8');
  if (!/^# Changelog\r?\n/.test(original)) throw new Error('Expected # Changelog heading.');
  updates.set(changelog, original.replace(/^# Changelog\r?\n(?:\r?\n)?/, `# Changelog\n\n## ${timestamp()} — Release ${next}\n\n- Bumped application version from ${state.version} to ${next}.\n\n`));
  for (const [file, content] of updates) writeFileSync(resolve(root, file), content);
  git(['add', '--', ...updates.keys()]);
  git(['commit', '-m', `chore: bump application version to ${next}`], true);
  console.log(`Version ${next} committed. Run node scripts/release.mjs build to publish installers.`);
}

function build(args) {
  if (args[0] === '--local') {
    versionState();
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'tauri', '--', 'build', ...args.slice(1)], {
      cwd: resolve(root, 'app'), stdio: 'inherit', shell: process.platform === 'win32',
    });
    return;
  }
  if (args.length) throw new Error('Use build or build --local [Tauri options].');
  requireCleanMaster();
  const { version } = versionState();
  const tag = `v${version}`;
  git(['fetch', 'origin', 'master']);
  try {
    git(['merge-base', '--is-ancestor', 'FETCH_HEAD', 'HEAD']);
  } catch {
    throw new Error('Local master does not include remote master. Pull its changes before publishing.');
  }
  if (git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`])) {
    throw new Error(`${tag} is already published. Bump the version before starting a new release.`);
  }
  const existing = git(['tag', '--list', tag]);
  if (existing) {
    if (git(['rev-parse', `${tag}^{commit}`]) !== git(['rev-parse', 'HEAD'])) {
      throw new Error(`Local tag ${tag} points to a different commit.`);
    }
  } else {
    git(['tag', '-a', tag, '-m', `SpecOps ${version}`]);
  }
  git(['push', '--atomic', 'origin', 'HEAD:refs/heads/master', `refs/tags/${tag}:refs/tags/${tag}`], true);
  console.log(`Release build started for ${tag}.\nhttps://github.com/AlexeyPerov/spec-ops/actions/workflows/release.yml`);
}

try {
  const [command = 'help', ...args] = process.argv.slice(2);
  if (['help', '--help', '-h'].includes(command)) console.log(help);
  else if (command === 'bump' && args.length <= 1) bump(args[0] ?? 'patch');
  else if (command === 'build') build(args);
  else throw new Error(help);
} catch (error) {
  console.error(error.stderr?.toString().trim() || error.message);
  process.exitCode = 1;
}
