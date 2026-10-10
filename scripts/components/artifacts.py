#!/usr/bin/env python3
"""CI-only finite payload assembly and domain-separated Ed25519 release signing."""
import argparse
import copy
import gzip
import hashlib
import json
import os
import re
import stat
import struct
import subprocess
import tarfile
import tempfile
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MAX_FILE = 512 * 1024 * 1024
MAX_TOTAL = 1536 * 1024 * 1024
MAX_FILES = 20000
CATALOG_DOMAIN = b'SpecOps component catalog v1\x00'
MANIFEST_DOMAIN = b'SpecOps component manifest v1\x00'
# Public test vector seed. Never accepted by the embedded release trust root.
FIXTURE_SEED = bytes.fromhex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def sign(key, data):
    key = Path(key).resolve()
    if key == REPO or REPO in key.parents:
        raise ValueError('Release private keys must be outside the repository')
    with tempfile.TemporaryDirectory(prefix='specops-sign-') as temp:
        message = Path(temp) / 'message'
        message.write_bytes(data)
        return subprocess.check_output(['openssl', 'pkeyutl', '-sign', '-rawin', '-inkey', str(key), '-in', str(message)]).hex()


def public_key(key):
    der = subprocess.check_output(['openssl', 'pkey', '-in', str(key), '-pubout', '-outform', 'DER'])
    if der[:12] != bytes.fromhex('302a300506032b6570032100') or len(der) != 44:
        raise ValueError('Ed25519 key required')
    return der[-32:].hex()


def fixture_key(directory):
    der = Path(directory) / 'fixture.der'
    der.write_bytes(bytes.fromhex('302e020100300506032b657004220420') + FIXTURE_SEED)
    key = Path(directory) / 'fixture.pem'
    subprocess.run(['openssl', 'pkey', '-inform', 'DER', '-in', str(der), '-out', str(key)], check=True, capture_output=True)
    os.chmod(key, 0o600)
    return key


def safe_path(path):
    return (0 < len(path.encode()) <= 512 and '\\' not in path and ':' not in path
            and all(part not in ('', '.', '..') and len(part.encode()) <= 255
                    and not any(ord(c) < 32 or ord(c) == 127 for c in part) for part in path.split('/')))


def binary_target(data):
    # Thin arm64 Mach-O only; fat/universal, ELF, PE and bytecode native files fail closed.
    if data[:4] == b'\xcf\xfa\xed\xfe':
        return 'darwin-arm64' if len(data) >= 8 and struct.unpack('<I', data[4:8])[0] == 0x0100000c else 'wrong-target'
    if data[:4] in (b'\xfe\xed\xfa\xcf', b'\xce\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca', b'\x7fELF') or data[:2] == b'MZ':
        return 'wrong-target'
    return None


SENSITIVE = re.compile(rb'(SPECOPS_CREDENTIAL_CANARY|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{64,4096}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?<![A-Za-z0-9_-])(?:sk-ant-|sk-proj-)[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])|(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9]))')
DEV_PATH = re.compile(rb'(?:/Users/[^/\x00\s]+/(?:Projects|\.npm|\.cache)/|/home/[^/\x00\s]+/(?:\.npm|\.cache)/)')


def inspect(root, spec, fixture=False):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Payload root must be a real directory')
    expected = {f['path']: f for f in spec['files']}
    if len(expected) != len(spec['files']) or not 0 < len(expected) <= MAX_FILES:
        raise ValueError('Invalid inventory count')
    entries = spec['entries']
    notices = spec['distribution']['noticePaths']
    if not entries or not notices or any(p not in expected for p in list(entries.values()) + notices):
        raise ValueError('Entry point and notice inventory required')
    # Policy pins every executable/native helper, beyond just the primary entry.
    executables = set(spec.get('approvedExecutables', []))
    actual = []
    actual_executables = set()
    normalized = set()
    total_bytes = 0
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root).as_posix()
        if not safe_path(relative):
            raise ValueError('Unsafe payload path')
        if path.is_symlink():
            raise ValueError('Links are forbidden')
        mode = path.stat().st_mode
        key = unicodedata.normalize('NFD', relative).casefold()
        if key in normalized:
            raise ValueError('Filesystem name collision')
        normalized.add(key)
        if stat.S_ISDIR(mode):
            continue
        if not stat.S_ISREG(mode) or path.stat().st_nlink != 1:
            raise ValueError('Special files and hardlinks are forbidden')
        total_bytes += path.stat().st_size
        if total_bytes > MAX_TOTAL:
            raise ValueError('Payload exceeds unpacked budget')
        if relative not in expected:
            raise ValueError('Unlisted payload file')
        if path.stat().st_size > MAX_FILE or mode & 0o7000:
            raise ValueError('Payload file limit or unsafe mode')
        digest = hashlib.sha256()
        tail = b''
        prefix = b''
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                if not prefix:
                    prefix = block[:8]
                scanned = tail + block
                if SENSITIVE.search(scanned) or DEV_PATH.search(scanned):
                    raise ValueError('Credential or development path in payload')
                tail = scanned[-8192:]
                digest.update(block)
        executable = bool(mode & 0o111)
        target = binary_target(prefix)
        if target == 'wrong-target':
            raise ValueError('Wrong-target native binary')
        if target or executable:
            actual_executables.add(relative)
            if relative not in executables:
                raise ValueError('Unapproved executable/helper')
            if not fixture and target != 'darwin-arm64':
                raise ValueError('Production executable must be target-native')
        row = dict(path=relative, bytes=path.stat().st_size, sha256=digest.hexdigest(), executable=executable)
        if row != expected[relative]:
            raise ValueError('Payload identity/mode mismatch')
        actual.append(row)
    if set(expected) != {f['path'] for f in actual} or executables != actual_executables:
        raise ValueError('Missing helper or executable inventory mismatch')
    if sum(f['bytes'] for f in actual) > MAX_TOTAL:
        raise ValueError('Payload exceeds unpacked budget')
    if any((root / p).stat().st_size == 0 for p in notices):
        raise ValueError('Empty legal notice')
    return actual


def assemble(root, spec, output, key, key_id, fixture=False):
    files = inspect(root, spec, fixture)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    manifest = copy.deepcopy(spec)
    manifest.pop('approvedExecutables', None)
    artifact = output / (manifest['id'] + '-' + manifest['version'] + '-darwin-arm64.tar.gz')
    with artifact.open('wb') as stream:
        with gzip.GzipFile(fileobj=stream, mode='wb', mtime=0, filename='', compresslevel=6) as compressed:
            with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.USTAR_FORMAT) as archive:
                for row in files:
                    info = tarfile.TarInfo(row['path'])
                    info.size = row['bytes']
                    info.mode = 0o755 if row['executable'] else 0o644
                    with (Path(root) / row['path']).open('rb') as source:
                        archive.addfile(info, source)
    if artifact.stat().st_size > MAX_FILE:
        artifact.unlink()
        raise ValueError('Payload exceeds archive budget')
    manifest['files'] = files
    manifest['archive'].update(sha256=sha(artifact.read_bytes()), compressedBytes=artifact.stat().st_size,
                               unpackedBytes=sum(f['bytes'] for f in files))
    manifest.pop('signature', None)
    signature = sign(key, MANIFEST_DOMAIN + canonical(manifest))
    manifest['signature'] = dict(algorithm='ed25519', keyId=key_id, value=signature)
    (output / (artifact.name + '.manifest.json')).write_bytes(canonical(manifest))
    return manifest


def envelope(catalog, key, key_id):
    payload = canonical(catalog)
    if len(payload) > 16 * 1024 * 1024:
        raise ValueError('Catalog exceeds byte budget')
    return dict(payloadHex=payload.hex(), signature=dict(algorithm='ed25519', keyId=key_id,
                value=sign(key, CATALOG_DOMAIN + payload)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--spec', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--signing-key', type=Path, required=True)
    parser.add_argument('--key-id', required=True)
    args = parser.parse_args()
    spec = json.loads(args.spec.read_bytes())
    if spec['distribution']['status'] != 'reviewed' or spec['distribution']['evidenceId'].startswith('as09-a-fixture'):
        raise ValueError('Reviewed release evidence required')
    assemble(args.root, spec, args.output, args.signing_key, args.key_id)
    print('Reviewable candidate produced; publication and execution clearance are separate gates')


if __name__ == '__main__':
    main()
