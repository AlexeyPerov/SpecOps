import pathlib,json,argparse
parser=argparse.ArgumentParser();parser.add_argument('--manifest',required=True);parser.add_argument('--open',type=int,choices=[5,30],required=True);args=parser.parse_args();count=args.open
base=pathlib.Path.home()/'Library/Application Support/com.alexeyperov.specops.workspacesbaselineinstrumented/spec-ops'
base.mkdir(parents=True,exist_ok=True)
manifest=json.loads(pathlib.Path(args.manifest).read_text())
def context(): return {'documents':[],'session':{'editorLayout':{'kind':'single','panes':[{'id':'pane-1','tabs':[],'selectedTabId':None}],'slots':[[0]],'activePaneId':'pane-1'},'lastActiveWindowId':'main','windowBounds':None}}
window={'activeContextId':'ws-1','notepad':context(),'workspaces':[{'id':f'ws-{i+1}','rootPath':p['rootPath'],'snapshot':context()} for i,p in enumerate(manifest['projects'][:count])],'editorPreferences':{'zoomPercent':100,'wrapLines':True},'activityRailWidthPx':240}
for f in base.glob('session*.json'):f.unlink()
(base/'session.json').write_text(json.dumps({'version':2,'updatedAt':'2026-10-18T09:00:00+03:00','lastActiveWindowId':'main','openFileRegistry':{},'recentFiles':[],'windows':{'main':window}}))
print(base)
