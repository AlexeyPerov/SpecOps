#!/usr/bin/env python3
"""Account-free signed fixture generator and bounded loopback fault server."""
import argparse
import copy
import json
import re
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from artifacts import REPO, assemble, canonical, envelope, fixture_key, public_key, sha


def generate(destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    templates = json.loads((REPO / 'app/src-tauri/fixtures/components/manifests.json').read_bytes())
    manifests = []
    with tempfile.TemporaryDirectory(prefix='specops-fixtures-') as temp:
        key = fixture_key(temp)
        for template in templates:
            root = Path(temp) / template['id']
            root.mkdir()
            for entry in template['files']:
                path = root / entry['path']
                path.parent.mkdir(parents=True, exist_ok=True)
                contents = b'#!/bin/sh\nprintf "SpecOps fixture ready\\n"\n' if entry['executable'] else b'SpecOps local fixture; synthetic data, no vendor software.\n'
                path.write_bytes(contents)
                path.chmod(0o755 if entry['executable'] else 0o644)
                entry.update(bytes=len(contents), sha256=sha(contents))
            template['approvedExecutables'] = [f['path'] for f in template['files'] if f['executable']]
            template['distribution']['status'] = 'reviewed'
            template['distribution']['evidenceId'] = 'local-fixture-only'
            name = template['id'] + '-' + template['version'] + '-darwin-arm64.tar.gz'
            # Logical HTTPS identity; only cfg(test) may map this origin to loopback transport.
            template['archive']['url'] = 'https://fixtures.invalid/v1/' + name
            manifests.append(assemble(root, template, destination, key, 'fixture-v1', fixture=True))
        catalog = dict(schemaVersion=1, revision=1, issuedAt=1791622800, expiresAt=1794214800,
                       rows=[dict(id=m['id'], version=m['version'], target=m['target'], availability='available',
                                  reason='local-fixture-only', manifest=m) for m in manifests], revoked=[])
        (destination / 'catalog.json').write_bytes(canonical(envelope(catalog, key, 'fixture-v1')))
        revoked = copy.deepcopy(catalog)
        revoked['revision'] = 2
        revoked['revoked'] = [dict(id=manifests[1]['id'], version=manifests[1]['version'],
                                   target=manifests[1]['target'], reason='fixture-security-rehearsal')]
        (destination / 'revoked-catalog.json').write_bytes(canonical(envelope(revoked, key, 'fixture-v1')))
        (destination / 'trust.json').write_bytes(canonical(dict(keyId='fixture-v1', publicKey=public_key(key))))


def handler(root):
    root = Path(root).resolve()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            parsed = urlsplit(self.path)
            query = parse_qs(parsed.query)
            name = parsed.path.removeprefix('/v1/').removeprefix('/') if hasattr(str, 'removeprefix') else parsed.path.lstrip('/').replace('v1/', '', 1)
            if not re.fullmatch(r'[a-zA-Z0-9._-]{1,160}', name):
                self.send_error(404)
                return
            path = root / name
            if not path.is_file() or path.is_symlink():
                self.send_error(404)
                return
            mode = query.get('mode', ['normal'])[0]
            if mode in ('503', '404', '429'):
                self.send_response(int(mode)); self.send_header('Retry-After', '1'); self.send_header('Content-Length', '0'); self.end_headers()
                return
            if mode == 'redirect':
                self.send_response(302); self.send_header('Location', 'https://unapproved.invalid/payload'); self.send_header('Content-Length', '0'); self.end_headers()
                return
            data = path.read_bytes()
            if mode == 'corrupt':
                data = bytes([data[0] ^ 1]) + data[1:]
            original = len(data)
            start, end = 0, original - 1
            range_header = self.headers.get('Range')
            if range_header and mode != 'ignore-range':
                match = re.fullmatch(r'bytes=(\d+)-(\d*)', range_header)
                if not match or int(match[1]) >= original:
                    self.send_response(416); self.send_header('Content-Range', 'bytes */' + str(original)); self.send_header('Content-Length', '0'); self.end_headers()
                    return
                start = int(match[1]); end = min(int(match[2]) if match[2] else end, end)
                if end < start:
                    self.send_error(416); return
                data = data[start:end + 1]
            self.send_response(206 if range_header and mode != 'ignore-range' else 200)
            self.send_header('Content-Type', 'application/json' if name.endswith('.json') else 'application/gzip')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('ETag', '"' + sha(path.read_bytes()) + '"')
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
            if range_header and mode != 'ignore-range':
                self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, original))
            self.end_headers()
            if mode == 'truncate':
                self.wfile.write(data[:len(data) // 2]); self.close_connection = True; return
            if mode == 'delay':
                time.sleep(0.2)
            if mode == 'disconnect':
                self.close_connection = True; return
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--port', type=int, default=0)
    args = parser.parse_args()
    generate(args.output)
    if args.serve:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), handler(args.output))
        print('Fixture server: http://127.0.0.1:%s/v1/' % server.server_port, flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()
