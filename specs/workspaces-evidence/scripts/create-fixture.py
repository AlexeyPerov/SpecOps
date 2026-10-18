#!/usr/bin/env python3
"""Create deterministic disposable 30-project workspace acceptance data."""
import json, os, pathlib, subprocess, sys
if len(sys.argv)!=2: raise SystemExit('Usage: create-fixture.py /unused/directory')
root=pathlib.Path(sys.argv[1]).resolve()
if root.exists(): raise SystemExit(f'Refusing to overwrite {root}; choose an unused directory')
root.mkdir(parents=True)
env={**os.environ,'GIT_AUTHOR_DATE':'2026-10-18T09:00:00+03:00','GIT_COMMITTER_DATE':'2026-10-18T09:00:00+03:00'}
def git(p,*args):
 return subprocess.run(['git','-C',str(p),*args],env=env,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True).stdout.strip()
projects=[]
for i in range(30):
 group=i//6
 name='shared-project' if i%6==0 else (('long-project-name-for-workspace-layout-'+str(i)) if i==8 else f'project-{i+1:02}')
 p=root/f'group-{group+1}'/('long-path-segment-for-disambiguation' if i==8 else 'projects')/name
 row={'index':i+1,'name':name,'rootPath':str(p),'folder':f'Group {group+1}','pinned':i in [0,7,14,21,28],'hidden':i in [4,12,22],'kind':'git'}
 if i==29:
  row['kind']='unavailable';projects.append(row);continue
 p.mkdir(parents=True)
 if i==27:
  row['kind']='linked-worktree';git(pathlib.Path(projects[0]['rootPath']),'worktree','add','-b','linked-fixture',str(p));projects.append(row);continue
 (p/'README.md').write_text(f'# Workspace fixture {i+1}\n')
 if i==26:
  row['kind']='plain-directory';projects.append(row);continue
 git(p,'init','-b','main');git(p,'config','user.name','Workspace Fixture');git(p,'config','user.email','fixture@example.invalid')
 if i==25:
  row['kind']='unborn';projects.append(row);continue
 git(p,'add','.');git(p,'commit','-m','Initial fixture')
 if i==28:
  row['kind']='large-untracked';(p/'untracked').mkdir()
  for n in range(5000):(p/'untracked'/f'file-{n:05}.txt').write_text('fixture\n')
 elif i==24:
  row['kind']='detached';git(p,'checkout','--detach','HEAD')
 elif i==23:
  row['kind']='conflict';git(p,'checkout','-b','other');(p/'README.md').write_text('other\n');git(p,'commit','-am','Other change');git(p,'checkout','main');(p/'README.md').write_text('main\n');git(p,'commit','-am','Main change')
  subprocess.run(['git','-C',str(p),'merge','other'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 elif i%3==0:(p/'README.md').write_text('modified\n')
 elif i%3==1:(p/'untracked.txt').write_text('untracked\n')
 projects.append(row)
(root/'manifest.json').write_text(json.dumps({'version':1,'projects':projects},indent=2)+'\n')
print(root/'manifest.json')
