#!/usr/bin/env python3
"""Bounded local candidate inventory and deterministic gzip cost, never installed acceptance."""
import argparse,hashlib,json,gzip,io,tarfile,subprocess,platform
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--app',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
repo=Path(__file__).resolve().parents[2];root=a.app.resolve();files=[];errors=[]
if not root.is_dir():raise SystemExit('Missing candidate app')
for path in sorted(root.rglob('*')):
 if path.is_symlink():errors.append('Unexpected symlink: '+str(path.relative_to(root)));continue
 if not path.is_file():continue
 relative=path.relative_to(root).as_posix();data=path.read_bytes()
 files.append(dict(path=relative,bytes=len(data),sha256=hashlib.sha256(data).hexdigest(),mode=path.stat().st_mode&0o777))
 allowed={'Contents/Info.plist','Contents/PkgInfo','Contents/MacOS/spec-ops','Contents/Resources/agent-host/index.js','Contents/Resources/icon.icns','Contents/_CodeSignature/CodeResources'}
 if relative not in allowed:errors.append('Unexpected base file: '+relative)
 if relative!='Contents/MacOS/spec-ops' and data[:4] in [b'\xcf\xfa\xed\xfe',b'\xce\xfa\xed\xfe',b'\xfe\xed\xfa\xcf',b'\xca\xfe\xba\xbe',b'\x7fELF']:
  errors.append('Unexpected native executable: '+relative)
required={'Contents/Info.plist','Contents/MacOS/spec-ops','Contents/Resources/agent-host/index.js','Contents/Resources/icon.icns'}
for missing in sorted(required-{f['path'] for f in files}):errors.append('Missing base file: '+missing)

compressed=io.BytesIO()
with gzip.GzipFile(fileobj=compressed,mode='wb',mtime=0,compresslevel=6,filename='') as gz:
 with tarfile.open(fileobj=gz,mode='w',format=tarfile.USTAR_FORMAT) as tar:
  for row in files:
   entry=tarfile.TarInfo(row['path']);entry.size=row['bytes'];entry.mode=row['mode'];tar.addfile(entry,io.BytesIO((root/row['path']).read_bytes()))
budgets=json.loads((repo/'specs/ops/09-plugin-based-usage/delivery-budgets.json').read_bytes())['base'];unpacked=sum(f['bytes'] for f in files);size=len(compressed.getvalue())
if unpacked>budgets['unpackedBytes']:errors.append('Unpacked budget exceeded')
if size>budgets['compressedBytes']:errors.append('Compressed budget exceeded')
# Source digest includes tracked files plus nonignored new files, with their names and bytes.
names=subprocess.check_output(['git','ls-files','-co','--exclude-standard','-z'],cwd=repo).split(b'\0');digest=hashlib.sha256()
excluded={b'specs/ops/09-plugin-based-usage/lean-base-candidate.json',b'specs/ops/08-release-gates/release-2026-10-11-components.json'}
for name in sorted(set(n for n in names if n)-excluded):
 path=repo/name.decode();digest.update(name+b'\0');digest.update(path.read_bytes() if path.is_file() else b'<missing>')
r=dict(schemaVersion=1,kind='unsigned-or-ad-hoc-local-candidate',source=dict(baseCommit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),dirty=bool(subprocess.check_output(['git','status','--porcelain'],cwd=repo,text=True).strip()),snapshotSha256=digest.hexdigest()),platform=dict(os=platform.system(),arch=platform.machine()),inventory=files,unpackedBytes=unpacked,localTarGzBytes=size,localTarGzSha256=hashlib.sha256(compressed.getvalue()).hexdigest(),compressedKind='deterministic-local-ustar-gzip-level-6-not-installer',budgetResult='pass' if not errors else 'fail',errors=errors,installedAcceptance='not-run',startupRssProcessAcceptance='not-run',baselineComparison='unavailable: A installed baseline has no reproducible source/signing identity')
a.output.write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({k:r[k] for k in ['unpackedBytes','localTarGzBytes','budgetResult','errors']},indent=2))
if errors:raise SystemExit(1)
