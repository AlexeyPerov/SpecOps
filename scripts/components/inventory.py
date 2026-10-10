#!/usr/bin/env python3
"""Read-only payload inventory; deterministic local gzip tar sizes are not release archives."""
import argparse
import gzip
import hashlib
import json
import os
import platform
import subprocess
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def inventory(root, names=None):
    paths = sorted((root / name for name in names), key=str) if names else sorted(root.rglob('*'))
    files = []
    for path in paths:
        if path.is_symlink():
            raise ValueError('Symlink in execution payload: ' + str(path))
        if path.is_file():
            files.append(dict(path=path.relative_to(root).as_posix(), bytes=path.stat().st_size,
                              sha256=digest(path), executable=bool(path.stat().st_mode & 0o111)))
    with tempfile.TemporaryFile() as compressed:
        with gzip.GzipFile(fileobj=compressed, mode='wb', mtime=0, filename='', compresslevel=6) as gz:
            with tarfile.open(fileobj=gz, mode='w|', format=tarfile.USTAR_FORMAT) as tar:
                for entry in files:
                    info = tar.gettarinfo(str(root / entry['path']), entry['path'])
                    info.uid = info.gid = info.mtime = 0
                    info.uname = info.gname = ''
                    with (root / entry['path']).open('rb') as source:
                        tar.addfile(info, source)
        compressed_bytes = compressed.tell()
    return dict(source=str(root), fileCount=len(files), unpackedBytes=sum(f['bytes'] for f in files),
                localTarGzBytes=compressed_bytes, files=files)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--codex', required=True, type=Path)
    parser.add_argument('--installed-app', type=Path, default=Path('/Applications/SpecOps.app'))
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    assets = repo / 'app/host/dist'
    node = repo / 'app/src-tauri/resources/agent-host'
    payloads = {
        'node': inventory(node, ['node', 'NODE-LICENSE.txt']),
        'host': inventory(assets, ['index.js']),
        'claude': inventory(assets / 'claude'),
        'cursor': inventory(assets / 'cursor'),
        'opencode': inventory(repo / 'app/src-tauri/binaries', ['opencode-aarch64-apple-darwin']),
        'codex': inventory(args.codex.parent, [args.codex.name]),
    }
    observed_codex = subprocess.check_output([str(args.codex), '--version'], text=True, timeout=5).strip()
    sidecar_path = repo / 'app/src-tauri/binaries/opencode-aarch64-apple-darwin'
    with sidecar_path.open('rb') as source:
        sidecar_is_wrapper = source.read(2) == b'#!'
    result = dict(schemaVersion=1, recordedAt=datetime.now(timezone.utc).isoformat(),
                  sourceCommit=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(),
                  target=dict(os=platform.system().lower(), arch=platform.machine(), osVersion=platform.mac_ver()[0]),
                  appVersion='0.3.0', hostVersion='0.1.0', catalogVersion='not-produced',
                  testedVersions=dict(node='24.15.0', codex='0.160.0', opencode='1.17.4', claudeSdk='0.3.289', claudeNative='2.1.289', cursor='1.0.35'),
                  observedCodexVersion=observed_codex,
                  payloadAcceptance=dict(node='prepared', host='prepared', claude='prepared', cursor='prepared', codex='prepared' if observed_codex == 'codex-cli 0.160.0' else 'incompatible: observed executable differs from tested pin', opencode='unavailable: source sidecar is a developer PATH wrapper' if sidecar_is_wrapper else 'unreviewed native payload'),
                  compression='Local deterministic USTAR/gzip level 6; not official archive or transport identity',
                  payloads=payloads, processBaselines=dict(editorOnly='not-run', firstUse='not-run', steadyState='not-run'))
    if args.installed_app.exists():
        # Installed app may contain links in the framework layout; measure regular bytes without following links.
        app_files = [p for p in args.installed_app.rglob('*') if p.is_file() and not p.is_symlink()]
        result['installedApp'] = dict(path=str(args.installed_app), fileCount=len(app_files),
                                      unpackedBytes=sum(p.stat().st_size for p in app_files),
                                      executableSha256=digest(args.installed_app / 'Contents/MacOS/spec-ops'),
                                      cleanBuild='unavailable: existing bundle has no reproducible source identity',
                                      signedAcceptance='unavailable: ad-hoc signature, no sealed resources or TeamIdentifier',
                                      archiveBytes=None)
    Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: {a: b for a, b in v.items() if a not in ['files', 'source']} for k, v in payloads.items()}, indent=2))


if __name__ == '__main__':
    main()
