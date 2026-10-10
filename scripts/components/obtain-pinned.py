#!/usr/bin/env python3
"""Fetch exact reviewed upstream candidates to an external CI workspace; never publish or install."""
import argparse
import hashlib
import json
import urllib.request
from pathlib import Path

SOURCES = {
 'codex': dict(version='0.160.0', url='https://github.com/openai/codex/releases/download/rust-v0.160.0/codex-package-aarch64-apple-darwin.tar.gz', bytes=129976298, sha256='007df41b607dbbc8d204b9746ce7fed2d4ce6c813f44c32ceee54175ca796525'),
 'opencode': dict(version='1.17.4', url='https://github.com/anomalyco/opencode/releases/download/v1.17.4/opencode-darwin-arm64.zip', bytes=39972304, sha256='7a26d5427ff33e4f5bc942ad923a3b5ce3c88c6705fdecca9c2e27b59365594a'),
}


def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--output',type=Path,required=True)
 args=parser.parse_args()
 args.output.mkdir(parents=True,exist_ok=True)
 evidence=[]
 for component,row in SOURCES.items():
  destination=args.output / row['url'].rsplit('/',1)[-1]
  digest=hashlib.sha256(); total=0
  request=urllib.request.Request(row['url'],headers={'User-Agent':'SpecOps-artifact-candidate/1'})
  try:
   with urllib.request.urlopen(request,timeout=30) as response,destination.open('wb') as stream:
    for block in iter(lambda:response.read(1024*1024),b''):
     total+=len(block)
     if total > row['bytes']: raise ValueError('Upstream archive exceeds exact size')
     digest.update(block); stream.write(block)
   if total!=row['bytes'] or digest.hexdigest()!=row['sha256']: raise ValueError('Upstream identity mismatch')
   evidence.append(dict(id=component,**row,observedSha256=digest.hexdigest(),state='verified-upstream-archive-only'))
  except Exception:
   destination.unlink(missing_ok=True)
   raise
 (args.output/'upstream-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
 print('Exact upstream archives verified; native signing/notices/clearance remain unaccepted')


if __name__=='__main__': main()
