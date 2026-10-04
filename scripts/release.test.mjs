import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'specops-release-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'checkout');
  mkdirSync(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  for (const file of ['scripts/release.mjs', 'app/package.json', 'app/package-lock.json', 'app/src-tauri/tauri.conf.json', 'app/src-tauri/Cargo.toml', 'app/src-tauri/Cargo.lock', 'specs/changelog.md']) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(join(source, file), join(root, file));
  }
  git('init', '-b', 'master');
  git('config', 'user.email', 'release-test@example.invalid');
  git('config', 'user.name', 'Release test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  git('add', '.');
  git('commit', '-m', 'Initial fixture');
  const run = (...args) => spawnSync(process.execPath, [join(root, 'scripts/release.mjs'), ...args], { cwd: base, encoding: 'utf8' });
  return { root, base, git, run, read: file => readFileSync(join(root, file), 'utf8').replaceAll('\r\n', '\n') };
}
function ok(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('bump synchronizes manifests and lockfiles, records changelog and commits only release files', t => {
  const f = fixture(t);
  const initial = JSON.parse(f.read('app/package.json')).version;
  const [major, minor, patch] = initial.split('.').map(Number);
  for (const [argument, expected] of [[undefined, `${major}.${minor}.${patch + 1}`], ['minor', `${major}.${minor + 1}.0`], ['major', `${major + 1}.0.0`], [`${major + 2}.3.4`, `${major + 2}.3.4`]]) {
    ok(f.run('bump', ...(argument ? [argument] : [])));
    assert.equal(JSON.parse(f.read('app/package.json')).version, expected);
    const lock = JSON.parse(f.read('app/package-lock.json'));
    assert.equal(lock.version, expected);
    assert.equal(lock.packages[''].version, expected);
    assert.equal(JSON.parse(f.read('app/src-tauri/tauri.conf.json')).version, expected);
    assert.match(f.read('app/src-tauri/Cargo.toml'), new RegExp(`version = "${expected.replaceAll('.', '\\.') }"`));
    assert.ok(f.read('app/src-tauri/Cargo.lock').includes(`name = "spec-ops"\nversion = "${expected}"`));
    assert.ok(f.read('specs/changelog.md').includes(`— Release ${expected}`));
    assert.equal(f.git('status', '--porcelain'), '');
    assert.equal(f.git('log', '-1', '--format=%s'), `chore: bump application version to ${expected}`);
    assert.equal(f.git('show', '--pretty=', '--name-only').split('\n').length, 6);
  }
});

test('invalid, unchanged and lower versions leave the checkout untouched', t => {
  const f = fixture(t);
  for (const input of ['nope', '01.2.3', '0.0.0', JSON.parse(f.read('app/package.json')).version, '1.2.3-beta.1']) {
    assert.notEqual(f.run('bump', input).status, 0);
    assert.equal(f.git('status', '--porcelain'), '');
  }
});

test('dirty checkout, staged changes, wrong branch and version mismatch block changes', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'unrelated.txt'), 'keep me');
  assert.match(f.run('bump').stderr, /Commit or stash/);
  f.git('add', 'unrelated.txt');
  assert.match(f.run('bump').stderr, /Commit or stash/);
  f.git('commit', '-m', 'Unrelated work');
  f.git('checkout', '-b', 'test');
  assert.match(f.run('bump').stderr, /Switch to master/);
  f.git('checkout', 'master');
  const config = JSON.parse(f.read('app/src-tauri/tauri.conf.json'));
  config.version = '99.0.0';
  writeFileSync(join(f.root, 'app/src-tauri/tauri.conf.json'), JSON.stringify(config));
  f.git('add', '.');
  f.git('commit', '-m', 'Mismatch fixture');
  assert.match(f.run('bump').stderr, /matching X.Y.Z/);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('build pushes master and its tag atomically and refuses duplicate releases', t => {
  const f = fixture(t);
  const remote = join(f.base, 'remote.git');
  f.git('init', '--bare', remote);
  f.git('remote', 'add', 'origin', remote);
  f.git('push', 'origin', 'master');
  ok(f.run('bump'));
  const version = JSON.parse(f.read('app/package.json')).version;
  ok(f.run('build'));
  assert.equal(f.git('rev-parse', 'origin/master'), f.git('rev-parse', 'HEAD'));
  assert.ok(f.git('ls-remote', '--tags', 'origin', `refs/tags/v${version}`).length);
  assert.match(f.run('build').stderr, /already published/);
  assert.notEqual(f.run('build', '--unknown').status, 0);
});

test('build refuses a local tag on another commit', t => {
  const f = fixture(t);
  f.git('init', '--bare', join(f.base, 'remote.git'));
  f.git('remote', 'add', 'origin', join(f.base, 'remote.git'));
  f.git('push', 'origin', 'master');
  const previous = f.git('rev-parse', 'HEAD');
  ok(f.run('bump'));
  const version = JSON.parse(f.read('app/package.json')).version;
  f.git('tag', `v${version}`, previous);
  assert.match(f.run('build').stderr, /different commit/);
  assert.equal(f.git('rev-parse', 'origin/master'), previous);
});

test('build blocks publication when local master is behind the remote', t => {
  const f = fixture(t);
  f.git('init', '--bare', join(f.base, 'remote.git'));
  f.git('remote', 'add', 'origin', join(f.base, 'remote.git'));
  f.git('push', 'origin', 'master');
  const previous = f.git('rev-parse', 'HEAD');
  ok(f.run('bump'));
  f.git('push', 'origin', 'master');
  f.git('reset', '--hard', previous);
  assert.notEqual(f.run('build').status, 0);
  assert.equal(f.git('tag', '--list'), '');
});

test('local macOS build opens only reported DMGs after success and preserves Tauri arguments', { skip: process.platform !== 'darwin' }, t => {
  const f = fixture(t);
  const bin = join(f.base, 'bin');
  mkdirSync(bin);
  const installer = join(f.base, 'Installer with spaces.dmg');
  const calls = join(f.base, 'mounted.json');
  const forwarded = join(f.base, 'args.json');
  writeFileSync(installer, 'fixture');
  const executable = (name, body) => {
    const path = join(bin, name);
    writeFileSync(path, `#!${process.execPath}\n${body}\n`);
    chmodSync(path, 0o755);
  };
  executable('hdiutil', `require('node:fs').writeFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)));`);
  const run = (...args) => spawnSync(process.execPath, [join(f.root, 'scripts/release.mjs'), 'build', '--local', ...args], {
    cwd: f.base, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  executable('npm', `require('node:fs').writeFileSync(${JSON.stringify(forwarded)}, JSON.stringify(process.argv.slice(2)));
    process.stderr.write(${JSON.stringify(`    \x1b[32m${installer}\x1b[0m\n`)});`);
  ok(run('--target', 'aarch64-apple-darwin', '--bundles', 'dmg'));
  assert.deepEqual(JSON.parse(readFileSync(calls, 'utf8')), ['attach', '-autoopen', installer]);
  assert.deepEqual(JSON.parse(readFileSync(forwarded, 'utf8')), ['run', 'tauri', '--', 'build', '--target', 'aarch64-apple-darwin', '--bundles', 'dmg']);
  rmSync(calls);
  executable('npm', `console.log('Finished app bundle');`);
  ok(run('--bundles', 'app'));
  assert.equal(existsSync(calls), false);
  executable('npm', `console.log(${JSON.stringify(installer)}); process.exitCode = 1;`);
  assert.notEqual(run().status, 0);
  assert.equal(existsSync(calls), false);
  executable('npm', `console.log(${JSON.stringify(installer)});`);
  executable('hdiutil', 'process.exitCode = 1;');
  const result = run();
  ok(result);
  assert.match(result.stderr, /Build succeeded, but the installer could not be opened/);
});
