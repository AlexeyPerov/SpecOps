#!/usr/bin/env python3
"""Re-sign real candidates under test-only trust and exercise native installer; no publication."""
import argparse,json,shutil,tempfile,time,threading,subprocess,os
from pathlib import Path
from http.server import ThreadingHTTPServer
from artifacts import canonical,fixture_key,sign,envelope,MANIFEST_DOMAIN,REPO
from fixtures import handler
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--candidates',type=Path,required=True);p.add_argument('--managed-probe',type=Path,required=True)
a=p.parse_args()
with tempfile.TemporaryDirectory(prefix='specops-managed-test-catalog-') as tmp:
 root=Path(tmp);key=fixture_key(root);manifests=[]
 for inventory in ['candidate-inventory.json','native-candidate-inventory.json']:
  manifests += json.loads((a.candidates/inventory).read_bytes())['manifests']
 for m in manifests:
  name=m['archive']['url'].rsplit('/',1)[-1]
  shutil.copyfile(a.candidates/name,root/name)
  m['archive']['url']='https://fixtures.invalid/v1/'+name
  m['distribution'].update(status='reviewed',evidenceId='real-vendor-test-only')
  m.pop('signature');m['signature']=dict(algorithm='ed25519',keyId='fixture-v1',value=sign(key,MANIFEST_DOMAIN+canonical(m)))
 stamp=int(time.time())
 catalog=dict(schemaVersion=1,revision=1,issuedAt=stamp-10,expiresAt=stamp+3600,rows=[dict(id=m['id'],version=m['version'],target=m['target'],availability='available',reason='real-vendor-test-only',manifest=m) for m in manifests],revoked=[])
 (root/'catalog.json').write_bytes(canonical(envelope(catalog,key,'fixture-v1')))
 server=ThreadingHTTPServer(('127.0.0.1',0),handler(root));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:
  subprocess.run(['cargo','test','--manifest-path',str(REPO/'app/src-tauri/Cargo.toml'),'real_candidate_native_installer_managed_probe','--','--ignored','--nocapture','--test-threads=1'],env={**os.environ,'SPECOPS_TEST_CANDIDATE_ROOT':str(root),'SPECOPS_TEST_CANDIDATE_ORIGIN':'http://127.0.0.1:'+str(server.server_port),'SPECOPS_TEST_MANAGED_PROBE':str(a.managed_probe.resolve())},check=True)
 finally:server.shutdown();thread.join()
