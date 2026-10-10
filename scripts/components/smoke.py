#!/usr/bin/env python3
"""Recheck candidate inventories and probe extracted components outside the checkout."""
import argparse
import json
import subprocess
import tarfile
import tempfile
from pathlib import Path
from artifacts import MAX_TOTAL, safe_path, sha


def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--candidates',type=Path,required=True)
 parser.add_argument('--evidence',type=Path,required=True)
 args=parser.parse_args()
 manifests=json.loads((args.candidates/'candidate-inventory.json').read_bytes())['manifests']
 native=args.candidates/'native-candidate-inventory.json'
 if native.exists():manifests+=json.loads(native.read_bytes())['manifests']
 with tempfile.TemporaryDirectory(prefix='specops-component-smoke-') as temp:
  root=Path(temp)
  for manifest in manifests:
   artifact=args.candidates/(manifest['id']+'-'+manifest['version']+'-darwin-arm64.tar.gz')
   if sha(artifact.read_bytes())!=manifest['archive']['sha256']:raise ValueError('Corrupt candidate')
   expected={f['path']:f for f in manifest['files']};seen=set();total=0
   with tarfile.open(artifact) as archive:
    for entry in archive:
     if not entry.isfile() or not safe_path(entry.name) or entry.name not in expected or entry.name in seen:raise ValueError('Unexpected archive member')
     row=expected[entry.name];seen.add(entry.name);total+=entry.size
     if total>MAX_TOTAL or entry.size!=row['bytes'] or bool(entry.mode & 0o111)!=row['executable']:raise ValueError('Archive inventory mismatch')
     destination=root/manifest['id']/entry.name;destination.parent.mkdir(parents=True,exist_ok=True)
     with archive.extractfile(entry) as source,destination.open('wb') as target:
      for block in iter(lambda:source.read(1024*1024),b''):target.write(block)
     destination.chmod(0o755 if row['executable'] else 0o644)
     if sha(destination.read_bytes())!=row['sha256']:raise ValueError('Extracted identity mismatch')
   if set(expected)!=seen:raise ValueError('Missing extracted helper')
  cmd=[str(root/'node/node'),str(Path(__file__).with_name('smoke.mjs')),str(root)]
  if native.exists():cmd.append('--native')
  result=subprocess.run(cmd,check=False,timeout=55,capture_output=True,text=True,env={'PATH':'/usr/bin:/bin','HOME':str(root/'private-probe')})
  if result.returncode:
   raise RuntimeError('Isolated probe failed: '+result.stderr[-4096:])
  evidence=json.loads(result.stdout)
  evidence['archives']=[dict(id=m['id'],version=m['version'],sha256=m['archive']['sha256'],compressedBytes=m['archive']['compressedBytes'],unpackedBytes=m['archive']['unpackedBytes'],fileCount=len(m['files'])) for m in manifests]
  args.evidence.write_text(json.dumps(evidence,indent=2)+'\n')
  print(json.dumps(evidence))


if __name__=='__main__':main()
