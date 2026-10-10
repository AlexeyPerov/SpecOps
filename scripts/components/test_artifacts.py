import copy
import hashlib
import http.client
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from artifacts import MAX_FILE, canonical, fixture_key, inspect, assemble, sha
from fixtures import generate, handler


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='specops-artifact-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'payload'
        self.root.mkdir()
        self.file('bin/tool', b'#!/bin/sh\nprintf "ready\\n"\n', True)
        self.file('LICENSE.txt', b'SpecOps test license\n')
        self.spec = dict(schemaVersion=1, id='node', version='24.15.0', target=dict(os='darwin', arch='arm64'),
                         compatibility=dict(appVersions=['0.3.0'],hostVersions=['0.1.0'],adapterRevision='as09-node-1',nativeStoreRevision='test-1'),
                         files=self.inventory(), entries={'main':'bin/tool'}, dependencies=[],
                         distribution=dict(status='reviewed',evidenceId='local-fixture-only',noticePaths=['LICENSE.txt']),
                         approvedExecutables=['bin/tool'],archive=dict(format='tar-gz',url='https://fixtures.invalid/v1/node-24.15.0-darwin-arm64.tar.gz',sha256='0'*64,compressedBytes=1,unpackedBytes=1))

    def file(self, path, contents, executable=False):
        path=self.root/path; path.parent.mkdir(parents=True,exist_ok=True)
        path.write_bytes(contents);path.chmod(0o755 if executable else 0o644)

    def inventory(self):
        return [dict(path=p.relative_to(self.root).as_posix(),bytes=p.stat().st_size,sha256=sha(p.read_bytes()),executable=bool(p.stat().st_mode & 0o111)) for p in sorted(self.root.rglob('*')) if p.is_file()]

    def refresh(self):
        self.spec['files']=self.inventory()

    def rejected(self):
        with self.assertRaises(ValueError): inspect(self.root,self.spec,fixture=True)

    def test_reproducible_archives_and_copied_smoke(self):
        key=fixture_key(self.temp.name)
        a=Path(self.temp.name)/'a';b=Path(self.temp.name)/'b'
        first=assemble(self.root,self.spec,a,key,'fixture-v1',fixture=True)
        os.utime(self.root/'bin/tool',(1000000,1000000))
        second=assemble(self.root,self.spec,b,key,'fixture-v1',fixture=True)
        self.assertEqual(first,second)
        self.assertEqual((a/'node-24.15.0-darwin-arm64.tar.gz').read_bytes(),(b/'node-24.15.0-darwin-arm64.tar.gz').read_bytes())
        copied=Path(self.temp.name)/'outside-checkout'
        with tarfile.open(a/'node-24.15.0-darwin-arm64.tar.gz') as archive:
            self.assertTrue(all(m.isfile() and m.uid==0 and m.gid==0 and m.mtime==0 for m in archive.getmembers()))
            archive.extractall(copied)
        result=subprocess.run([str(copied/'bin/tool')],env={'PATH':'/nonexistent','HOME':str(copied)},capture_output=True,check=True)
        self.assertEqual(result.stdout,b'ready\n')

    def test_unlisted_missing_corrupt_permission_and_canary(self):
        self.file('rogue',b'rogue');self.rejected();(self.root/'rogue').unlink()
        old=(self.root/'bin/tool').read_bytes();(self.root/'bin/tool').unlink();self.rejected()
        self.file('bin/tool',old,True)
        self.file('bin/tool',b'corrupt',True);self.rejected()
        self.file('bin/tool',old,False);self.rejected()
        self.file('bin/tool',old,True)
        self.file('LICENSE.txt',b'SPECOPS_CREDENTIAL_CANARY');self.refresh();self.rejected()

    def test_links_wrong_architecture_unapproved_helper_and_limits(self):
        (self.root/'link').symlink_to('LICENSE.txt');self.rejected();(self.root/'link').unlink()
        self.file('bin/tool',b'\x7fELF'+b'0'*64,True);self.refresh();self.rejected()
        self.file('bin/tool',b'#!/bin/sh\nexit 0',True);self.refresh()
        self.spec['approvedExecutables']=[];self.rejected();self.spec['approvedExecutables']=['bin/tool']
        with patch('artifacts.MAX_FILE',1): self.rejected()
        self.file('LICENSE.txt',b'/Users/test/Projects/private/config');self.refresh();self.rejected()

    def test_native_production_architecture_and_notices(self):
        with self.assertRaises(ValueError): inspect(self.root,self.spec)
        self.file('bin/tool',bytes.fromhex('cffaedfe0c000001')+b'0'*32,True);self.refresh()
        inspect(self.root,self.spec)
        self.file('LICENSE.txt',b'');self.refresh();self.rejected()

    def test_deterministic_all_five_fixture_generation(self):
        a=Path(self.temp.name)/'a';b=Path(self.temp.name)/'b';generate(a);generate(b)
        self.assertEqual({p.name:sha(p.read_bytes()) for p in a.iterdir()},{p.name:sha(p.read_bytes()) for p in b.iterdir()})
        self.assertEqual(len(list(a.glob('*.tar.gz'))),5)

    def test_loopback_fault_status_range_and_corruption(self):
        root=Path(self.temp.name)/'server';generate(root)
        server=ThreadingHTTPServer(('127.0.0.1',0),handler(root))
        worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
        self.addCleanup(server.server_close);self.addCleanup(server.shutdown)
        def request(path,headers={}):
            connection=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
            connection.request('GET',path,headers=headers);response=connection.getresponse();data=response.read();connection.close()
            return response,data
        url='/v1/node-24.15.0-darwin-arm64.tar.gz'
        response,data=request(url);self.assertEqual(response.status,200)
        response,partial=request(url,{'Range':'bytes=2-7'});self.assertEqual(response.status,206);self.assertEqual(partial,data[2:8])
        self.assertEqual(response.getheader('Content-Range'),'bytes 2-7/'+str(len(data)))
        self.assertEqual(request(url,{'Range':'bytes=99999-'})[0].status,416)
        self.assertEqual(request(url+'?mode=503')[0].status,503)
        self.assertEqual(request(url+'?mode=429')[0].status,429)
        self.assertEqual(request(url+'?mode=redirect')[0].status,302)
        self.assertEqual(request(url+'?mode=ignore-range',{'Range':'bytes=2-'})[0].status,200)
        self.assertNotEqual(sha(request(url+'?mode=corrupt')[1]),sha(data))
        with self.assertRaises(http.client.IncompleteRead): request(url+'?mode=truncate')
        self.assertEqual(request('/v1/../catalog.json')[0].status,404)


if __name__=='__main__':unittest.main()
