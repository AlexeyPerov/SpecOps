#!/usr/bin/env python3
"""Seed an isolated native acceptance profile while the app is stopped."""
import argparse,copy,json,pathlib
p=argparse.ArgumentParser();p.add_argument('--manifest',required=True);p.add_argument('--open',type=int,choices=[0,5,30],required=True);p.add_argument('--identifier',default='com.alexeyperov.specops.workspacesacceptance');p.add_argument('--width',type=int,default=240);p.add_argument('--force',action='store_true');a=p.parse_args()
if not a.identifier.startswith('com.alexeyperov.specops.workspacesacceptance'):raise SystemExit('Only dedicated workspace acceptance profiles are allowed')
base=pathlib.Path.home()/'Library/Application Support'/a.identifier/'spec-ops'
if base.exists() and not a.force:raise SystemExit(f'{base} exists: stop app, back up evidence, then pass --force')
base.mkdir(parents=True,exist_ok=True)
projects=json.loads(pathlib.Path(a.manifest).read_text())['projects']
def context():return {'documents':[],'session':{'editorLayout':{'kind':'single','panes':[{'id':'pane-1','tabs':[],'selectedTabId':None}],'slots':[[0]],'activePaneId':'pane-1'},'lastActiveWindowId':'main','windowBounds':None}}
folders={f'fixture-group-{i+1}':{'id':f'fixture-group-{i+1}','name':f'Group {i+1}','order':i} for i in range(5)}
catalog={'version':1,'revision':1,'projects':{},'folders':folders,'savedContexts':{}}
for i,row in enumerate(projects):
 root=str(pathlib.Path(row['rootPath']).resolve());identity=root.lower();catalog['projects'][identity]={'id':identity,'rootPath':root,'name':row['name'],'folderId':f'fixture-group-{i//6+1}','order':i,'pinned':row['pinned'],'pinnedOrder':i,'hiddenFromRail':row['hidden'],'documentStorage':'app'}
 if i==29:catalog['projects'][identity]['openError']='Project directory is unavailable.'
window={'activeContextId':'ws-1' if a.open else 'notepad','notepad':context(),'workspaces':[{'id':f'ws-{i+1}','rootPath':str(pathlib.Path(row['rootPath']).resolve()),'snapshot':context()} for i,row in enumerate(projects[:a.open])],'editorPreferences':{'zoomPercent':100,'wrapLines':True},'activityRailWidthPx':a.width}
# Reset only acceptance-owned state files. Existing source fixture directories survive.
for pattern in ['session*.json','project-catalog*.json','workspace-windows.json','open-files.json']:
 for file in base.glob(pattern):file.unlink()
(base/'project-favorites.json').write_text('{}')
(base/'project-catalog.json').write_text(json.dumps(catalog))
(base/'session.json').write_text(json.dumps({'version':2,'updatedAt':'2026-10-18T15:00:00+03:00','lastActiveWindowId':'main','openFileRegistry':{},'recentFiles':[],'windows':{'main':window}}))
print(base)
