#!/usr/bin/env python3
"""Add read-only counters to an archived baseline checkout, never the live app."""
from pathlib import Path
import difflib,json,argparse
parser=argparse.ArgumentParser();parser.add_argument('--source',required=True);parser.add_argument('--patch',required=True);args=parser.parse_args()
root=Path(args.source).resolve()/'app/src-tauri/src'
if root == Path(__file__).resolve().parents[3]/'app/src-tauri/src': raise SystemExit('Use an archived baseline checkout, never this repository')
changed={}
p=root/'git.rs';old=p.read_text();s=old.replace('AtomicBool, Ordering','AtomicBool, AtomicU64, Ordering');marker='static GIT_EXECUTABLE: OnceLock<PathBuf> = OnceLock::new();';s=s.replace(marker,marker+'''
static GIT_PROCESSES_STARTED: AtomicU64 = AtomicU64::new(0);
pub(crate) fn git_processes_started() -> u64 { GIT_PROCESSES_STARTED.load(Ordering::Relaxed) }
fn spawn_tracked_git(command: &mut Command) -> std::io::Result<Child> {
    let child = command.spawn()?;
    GIT_PROCESSES_STARTED.fetch_add(1, Ordering::Relaxed);
    Ok(child)
}
fn tracked_git_output(command: &mut Command) -> std::io::Result<std::process::Output> {
    spawn_tracked_git(command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()))?.wait_with_output()
}
''');s=s.replace('Command::new(&binary).arg("--version").output()','tracked_git_output(Command::new(&binary).arg("--version"))').replace('Command::new(binary).arg("--version").output()','tracked_git_output(Command::new(binary).arg("--version"))');s=s.replace('let mut child = command\n        .spawn()','let mut child = spawn_tracked_git(&mut command)').replace('let child = match command.spawn() {','let child = match spawn_tracked_git(&mut command) {');p.write_text(s);changed['git.rs']=(old,s)
p=root/'file_watcher.rs';old=p.read_text();s=old+'''
#[tauri::command(async)]
pub async fn workspace_acceptance_diagnostics(state: State<'_, FileWatcherState>) -> Result<serde_json::Value, String> {
    let shared = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let inner = shared.lock().map_err(|error|error.to_string())?;
        Ok(serde_json::json!({"gitProcessesStarted":crate::git::git_processes_started(),"filePathCount":inner.watched_paths.len(),"projectRootCount":inner.project_tree_roots.len(),"projectRoots":inner.project_tree_roots.iter().collect::<Vec<_>>()}))
    }).await.map_err(|error|error.to_string())?
}
''';p.write_text(s);changed['file_watcher.rs']=(old,s)
p=root/'lib.rs';old=p.read_text();s=old.replace('file_watcher::sync_project_tree_watcher,','file_watcher::sync_project_tree_watcher,\n            file_watcher::workspace_acceptance_diagnostics,');assert s!=old;p.write_text(s);changed['lib.rs']=(old,s)
Path(args.patch).write_text(''.join(''.join(difflib.unified_diff(a.splitlines(True),b.splitlines(True),fromfile=name,tofile=name)) for name,(a,b) in changed.items()))
