#!/usr/bin/env python3
"""Build separate candidates from the pinned finite prepared inventory, without runtime install scripts."""
import argparse
import copy
import json
import shutil
import tempfile
from pathlib import Path
from artifacts import REPO, assemble, binary_target, canonical

ENTRIES = {
 'node': {'main':'node'},
 'claude': {'main':'sdk.mjs','native':'claude'},
 'cursor': {'main':'session-worker.mjs','profileWorker':'worker.mjs','sdk':'node_modules/@cursor/sdk/dist/esm/index.js',
            'search':'node_modules/@cursor/sdk-darwin-arm64/bin/rg','sandbox':'node_modules/@cursor/sdk-darwin-arm64/bin/cursorsandbox'},
}


def recipe(component, inventory, root):
 template = next(m for m in json.loads((REPO/'app/src-tauri/fixtures/components/manifests.json').read_bytes()) if m['id']==component)
 template['files']=copy.deepcopy(inventory['payloads'][component]['files'])
 template['entries']=ENTRIES[component]
 template['distribution']=dict(status='unavailable',evidenceId='candidate-review-pending',noticePaths=[f['path'] for f in template['files'] if 'license' in f['path'].lower() or 'notice' in f['path'].lower()])
 # The approved list comes only from pinned source inventory and native asset headers;
 # every digest is rechecked before this list can produce an artifact.
 template['approvedExecutables']=[]
 for file in template['files']:
  with (root/file['path']).open('rb') as stream: header=stream.read(8)
  if file['executable'] or binary_target(header):template['approvedExecutables'].append(file['path'])
 template['archive']['url']='https://release-unavailable.invalid/v1/'+component+'-'+template['version']+'-darwin-arm64.tar.gz'
 return template


def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--inventory',type=Path,default=REPO/'specs/ops/09-plugin-based-usage/payload-inventory.json')
 parser.add_argument('--output',type=Path,required=True)
 parser.add_argument('--signing-key',type=Path,required=True)
 parser.add_argument('--key-id',required=True)
 args=parser.parse_args()
 inventory=json.loads(args.inventory.read_bytes())
 manifests=[]
 with tempfile.TemporaryDirectory(prefix='specops-prepared-') as temp:
  for component in ENTRIES:
   root=Path(temp)/component;root.mkdir()
   source=REPO/('app/src-tauri/resources/agent-host' if component=='node' else 'app/host/dist/'+component)
   for row in inventory['payloads'][component]['files']:
    destination=root/row['path'];destination.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(source/row['path'],destination,follow_symlinks=False)
   manifests.append(assemble(root,recipe(component,inventory,root),args.output,args.signing_key,args.key_id))
 (args.output/'candidate-inventory.json').write_bytes(canonical(dict(schemaVersion=1,target='darwin-arm64',manifests=manifests,acceptance='source-candidate-only')))
 print('Three finite candidates assembled; original bundled resources retained; release rows remain unavailable')


if __name__=='__main__': main()
