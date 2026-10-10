#!/usr/bin/env python3
"""Prepare verified upstream archive candidates with a finite target inventory; no account execution."""
import argparse
import importlib.util
import json
import os
import stat
import tarfile
import urllib.request
import zipfile
from pathlib import Path
from artifacts import REPO, MAX_FILE, MAX_TOTAL, MAX_FILES, safe_path, sha, binary_target, canonical, inspect, assemble

loader=importlib.util.spec_from_file_location('pinned',Path(__file__).with_name('obtain-pinned.py'))
pinned=importlib.util.module_from_spec(loader);loader.loader.exec_module(pinned)
NOTICES={
 'codex':'https://raw.githubusercontent.com/openai/codex/rust-v0.160.0/LICENSE',
 'opencode':'https://raw.githubusercontent.com/anomalyco/opencode/v1.17.4/LICENSE',
}


def prepare(component, source, output):
 row=pinned.SOURCES[component]
 source=Path(source)
 if source.stat().st_size!=row['bytes'] or sha(source.read_bytes())!=row['sha256']:raise ValueError('Exact upstream archive required')
 output=Path(output);output.mkdir(parents=True,exist_ok=False)
 count=0;total=0;seen=set()
 def write(name,size,mode,stream):
  nonlocal count,total
  if not safe_path(name) or name.lower() in seen:raise ValueError('Unsafe archive path or collision')
  count+=1;total+=size
  if count>MAX_FILES or size>MAX_FILE or total>MAX_TOTAL:raise ValueError('Native payload limit')
  seen.add(name.lower())
  path=output/name;path.parent.mkdir(parents=True,exist_ok=True)
  with path.open('xb') as destination:
   remaining=size
   while remaining:
    data=stream.read(min(1024*1024,remaining))
    if not data:raise ValueError('Truncated member')
    destination.write(data);remaining-=len(data)
  path.chmod(0o755 if mode & 0o111 else 0o644)
 if component=='codex':
  with tarfile.open(source) as archive:
   for entry in archive:
    if entry.isdir():
     if not safe_path(entry.name.rstrip('/')):raise ValueError('Unsafe directory')
     continue
    if not entry.isfile() or entry.mode & 0o7000:raise ValueError('Forbidden member')
    with archive.extractfile(entry) as stream:write(entry.name,entry.size,0o644 if entry.name == 'codex-resources/voice/runtime.json' else entry.mode,stream)
 else:
  with zipfile.ZipFile(source) as archive:
   for entry in archive.infolist():
    mode=entry.external_attr>>16
    if entry.is_dir() or stat.S_ISLNK(mode):raise ValueError('Unexpected ZIP member')
    with archive.open(entry) as stream:write(entry.filename,entry.file_size,0o755,stream)
 with urllib.request.urlopen(NOTICES[component],timeout=30) as response:
  notice=response.read(1024*1024+1)
 if not 0<len(notice)<=1024*1024:raise ValueError('Notice limit')
 (output/'LICENSE.txt').write_bytes(notice)
 template=next(m for m in json.loads((REPO/'app/src-tauri/fixtures/components/manifests.json').read_bytes()) if m['id']==component)
 files=[];native=[]
 for path in sorted(output.rglob('*')):
  if path.is_file():
   relative=path.relative_to(output).as_posix()
   with path.open('rb') as stream:header=stream.read(8)
   if path.stat().st_mode & 0o111 or binary_target(header):native.append(relative)
   files.append(dict(path=relative,bytes=path.stat().st_size,sha256=sha(path.read_bytes()),executable=bool(path.stat().st_mode & 0o111)))
 template['files']=files
 template['entries']={'main':'bin/codex' if component=='codex' else 'opencode'}
 template['approvedExecutables']=native
 template['distribution']=dict(status='unavailable',evidenceId='upstream-candidate-review-pending',noticePaths=[f['path'] for f in files if 'license' in f['path'].lower() or 'notice' in f['path'].lower()])
 template['archive']['url']='https://release-unavailable.invalid/v1/'+component+'-'+row['version']+'-darwin-arm64.tar.gz'
 inspect(output,template)
 return template


def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--downloads',type=Path,required=True)
 parser.add_argument('--workdir',type=Path,required=True)
 parser.add_argument('--output',type=Path,required=True)
 parser.add_argument('--signing-key',type=Path,required=True)
 parser.add_argument('--key-id',required=True)
 args=parser.parse_args();manifests=[]
 args.workdir.mkdir(parents=True,exist_ok=True)
 for component,row in pinned.SOURCES.items():
  root=args.workdir/component
  template=prepare(component,args.downloads/row['url'].rsplit('/',1)[-1],root)
  manifests.append(assemble(root,template,args.output,args.signing_key,args.key_id))
 (args.output/'native-candidate-inventory.json').write_bytes(canonical(dict(schemaVersion=1,target='darwin-arm64',manifests=manifests,upstreamSources=pinned.SOURCES,acceptance='source-candidate-only')))
 print('Exact native candidates prepared; full notice/signing/account acceptance remains open')


if __name__=='__main__':main()
