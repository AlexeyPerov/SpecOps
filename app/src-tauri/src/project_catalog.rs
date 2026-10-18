//! App-wide project catalog transactions. The OS releases the advisory lock on
//! process death; no timeout or frontend watchdog can permit concurrent writers.
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::Write,
    path::Path,
};
use tauri::{Emitter, Manager};

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Project {
    id: String,
    root_path: String,
    name: String,
    folder_id: Option<String>,
    order: f64,
    pinned: bool,
    pinned_order: f64,
    hidden_from_rail: bool,
    document_storage: String,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
struct Folder {
    id: String,
    name: String,
    order: f64,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    version: u32,
    revision: u64,
    projects: BTreeMap<String, Project>,
    folders: BTreeMap<String, Folder>,
    saved_contexts: BTreeMap<String, Value>,
}
impl Default for Catalog {
    fn default() -> Self {
        Self {
            version: 1,
            revision: 0,
            projects: BTreeMap::new(),
            folders: BTreeMap::new(),
            saved_contexts: BTreeMap::new(),
        }
    }
}
fn identity(root: &str) -> String {
    let mut result = root.replace('\\', "/");
    while result.len() > 1 && result.ends_with('/') {
        result.pop();
    }
    if cfg!(any(target_os = "macos", target_os = "windows")) {
        result = result.to_lowercase();
    }
    result
}
fn decode(bytes: &[u8]) -> Result<Catalog, String> {
    let catalog: Catalog =
        serde_json::from_slice(bytes).map_err(|e| format!("Invalid project catalog: {e}"))?;
    validate(&catalog)?;
    Ok(catalog)
}
fn validate(c: &Catalog) -> Result<(), String> {
    if c.version != 1 {
        return Err("Unsupported project catalog version".into());
    }
    for (id, p) in &c.projects {
        if id != &p.id
            || id != &identity(&p.root_path)
            || !Path::new(&p.root_path).is_absolute()
            || p.name.trim().is_empty()
            || !matches!(p.document_storage.as_str(), "app" | "project")
            || p.folder_id
                .as_ref()
                .is_some_and(|id| !c.folders.contains_key(id))
        {
            return Err("Invalid project catalog entry".into());
        }
    }
    for (id, f) in &c.folders {
        if id != &f.id || id.is_empty() || f.name.trim().is_empty() {
            return Err("Invalid project folder".into());
        }
    }
    for (id, context) in &c.saved_contexts {
        if context.get("recoveryBuffers").is_some()
            || context
                .get("snapshot")
                .and_then(|s| s.get("documents"))
                .and_then(Value::as_array)
                .is_some_and(|docs| {
                    docs.iter().any(|doc| {
                        doc.get("content").is_some() || doc.get("savedContent").is_some()
                    })
                })
        {
            return Err("Saved project catalog must contain metadata only".into());
        }
        if !c.projects.contains_key(id)
            || !context.get("savedAt").is_some_and(Value::is_string)
            || !context
                .get("snapshot")
                .and_then(|v| v.get("documents"))
                .is_some_and(Value::is_array)
            || !context
                .get("snapshot")
                .and_then(|v| v.get("session"))
                .is_some_and(Value::is_object)
        {
            return Err("Invalid saved project context".into());
        }
    }
    Ok(())
}
fn recover(bytes: &[u8]) -> Result<Catalog, String> {
    let mut catalog = decode(bytes)?;
    // Backup trails main by at most one committed revision. Reserve that
    // revision and advance beyond it so recovery cannot reuse a cached version.
    catalog.revision = catalog
        .revision
        .checked_add(2)
        .ok_or("Catalog revision overflow")?;
    Ok(catalog)
}
fn load(root: &Path) -> Result<(Catalog, bool), String> {
    let main = root.join("project-catalog.json");
    let backup = root.join("project-catalog.backup.json");
    let primary = fs::read(&main);
    match primary {
        Ok(bytes) => match decode(&bytes) {
            Ok(c) => Ok((c, false)),
            Err(error) => fs::read(&backup)
                .map_err(|_| error.clone())
                .and_then(|bytes| {
                    recover(&bytes)
                        .map(|catalog| (catalog, true))
                        .map_err(|_| error)
                }),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => match fs::read(&backup) {
            Ok(bytes) => recover(&bytes).map(|catalog| (catalog, true)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok((Catalog::default(), false)),
            Err(e) => Err(e.to_string()),
        },
        Err(error) => Err(error.to_string()),
    }
}
/// Never delete/truncate an existing target as a fallback for a failed rename.
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = path.with_extension("tmp");
    let result = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temp, path)?;
        #[cfg(unix)]
        File::open(path.parent().unwrap())?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|e| format!("Project catalog write failed: {e}"))
}
fn sorted_projects(c: &Catalog, folder: Option<&str>, pinned: bool) -> Vec<String> {
    let mut projects: Vec<_> = c
        .projects
        .values()
        .filter(|p| {
            if pinned {
                p.pinned
            } else {
                p.folder_id.as_deref() == folder
            }
        })
        .collect();
    projects.sort_by(|a, b| {
        (if pinned { a.pinned_order } else { a.order })
            .total_cmp(&(if pinned { b.pinned_order } else { b.order }))
            .then(a.id.cmp(&b.id))
    });
    projects.into_iter().map(|p| p.id.clone()).collect()
}
fn place_project(
    c: &mut Catalog,
    folder: Option<&str>,
    pinned: bool,
    id: &str,
    before: Option<&str>,
) {
    let mut ids = sorted_projects(c, folder, pinned);
    ids.retain(|candidate| candidate != id);
    let index = before
        .and_then(|before| ids.iter().position(|candidate| candidate == before))
        .unwrap_or(ids.len());
    ids.insert(index, id.to_string());
    for (index, id) in ids.into_iter().enumerate() {
        let p = c.projects.get_mut(&id).unwrap();
        if pinned {
            p.pinned_order = index as f64;
        } else {
            p.order = index as f64;
        }
    }
}
fn move_project(c: &mut Catalog, mutation: &Value, id: &str) -> Result<(), String> {
    let project = c.projects.get_mut(id).ok_or("Project is not registered")?;
    let old_folder = project.folder_id.clone();
    if let Some(folder) = mutation.get("folderId") {
        project.folder_id = if folder.is_null() {
            None
        } else {
            Some(folder.as_str().ok_or("Invalid project folder")?.to_string())
        };
    }
    if let Some(pinned) = mutation.get("pinned") {
        project.pinned = pinned.as_bool().ok_or("Invalid pin state")?;
    }
    let pinned = project.pinned;
    let folder = project.folder_id.clone();
    let before = mutation.get("beforeId").and_then(Value::as_str);
    // Folder assignment preserves pinning but appends to the new remembered folder order.
    // Pin/unpin alone never changes that position.
    if folder != old_folder || (!pinned && mutation.get("beforeId").is_some()) {
        place_project(
            c,
            folder.as_deref(),
            false,
            id,
            if pinned { None } else { before },
        );
    }
    if pinned
        && (mutation.get("pinned").and_then(Value::as_bool) == Some(true)
            || (mutation.get("beforeId").is_some() && mutation.get("folderId").is_none()))
    {
        place_project(c, None, true, id, before);
    }
    Ok(())
}
fn apply(c: &mut Catalog, mutation: &Value) -> Result<(), String> {
    let kind = mutation
        .get("type")
        .and_then(Value::as_str)
        .ok_or("Catalog mutation type required")?;
    let id = mutation.get("id").and_then(Value::as_str).unwrap_or("");
    match kind {
        "register" => {
            let mut project: Project =
                serde_json::from_value(mutation["project"].clone()).map_err(|e| e.to_string())?;
            if !c.projects.contains_key(&project.id) {
                project.order = c.projects.values().map(|p| p.order).fold(-1.0, f64::max) + 1.0;
                project.pinned_order = project.order;
                c.projects.insert(project.id.clone(), project);
            }
        }
        "updateProject" => {
            let project = c.projects.get(id).ok_or("Project is not registered")?;
            let mut value = serde_json::to_value(project).map_err(|e| e.to_string())?;
            let patch = mutation["patch"]
                .as_object()
                .ok_or("Project patch required")?;
            for (key, val) in patch {
                if matches!(key.as_str(), "id" | "rootPath") {
                    return Err("Project identity cannot change".into());
                }
                if val.is_null() && key != "folderId" {
                    value.as_object_mut().unwrap().remove(key);
                } else {
                    value[key] = val.clone();
                }
            }
            let project = serde_json::from_value(value).map_err(|e| e.to_string())?;
            c.projects.insert(id.to_string(), project);
        }
        "moveProject" => move_project(c, mutation, id)?,
        "moveFolder" => {
            if !c.folders.contains_key(id) {
                return Err("Project folder is not registered".into());
            }
            let mut folders: Vec<_> = c.folders.values().collect();
            folders.sort_by(|a, b| a.order.total_cmp(&b.order).then(a.id.cmp(&b.id)));
            let mut ids: Vec<_> = folders
                .into_iter()
                .filter(|f| f.id != id)
                .map(|f| f.id.clone())
                .collect();
            let before = mutation.get("beforeId").and_then(Value::as_str);
            let index = before
                .and_then(|before| ids.iter().position(|candidate| candidate == before))
                .unwrap_or(ids.len());
            ids.insert(index, id.to_string());
            for (index, id) in ids.into_iter().enumerate() {
                c.folders.get_mut(&id).unwrap().order = index as f64;
            }
        }
        "renameFolder" => {
            c.folders
                .get_mut(id)
                .ok_or("Project folder is not registered")?
                .name = mutation["name"]
                .as_str()
                .ok_or("Folder name required")?
                .to_string();
        }
        "putFolder" => {
            let mut folder: Folder =
                serde_json::from_value(mutation["folder"].clone()).map_err(|e| e.to_string())?;
            if !c.folders.contains_key(&folder.id) {
                folder.order = c.folders.values().map(|f| f.order).fold(-1.0, f64::max) + 1.0;
            }
            c.folders.insert(folder.id.clone(), folder);
        }
        "removeFolder" => {
            let moved = sorted_projects(c, Some(id), false);
            let mut order = c
                .projects
                .values()
                .filter(|p| p.folder_id.is_none())
                .map(|p| p.order)
                .fold(-1.0, f64::max)
                + 1.0;
            c.folders.remove(id);
            for id in moved {
                let p = c.projects.get_mut(&id).unwrap();
                p.folder_id = None;
                p.order = order;
                order += 1.0;
            }
        }
        "saveContext" => {
            if !c.projects.contains_key(id) {
                return Err("Project is not registered".into());
            }
            c.saved_contexts
                .insert(id.to_string(), mutation["context"].clone());
        }
        "removeProject" => {
            c.projects.remove(id);
            c.saved_contexts.remove(id);
        }
        _ => return Err("Unknown catalog mutation".into()),
    }
    validate(c)
}
#[cfg(test)]
fn transact_with_status(root: &Path, mutations: &[Value]) -> Result<(Catalog, bool), String> {
    transact_with_windows(root, mutations, &std::collections::HashSet::new())
}
#[cfg(test)]
fn transact_with_windows(
    root: &Path,
    mutations: &[Value],
    live_windows: &std::collections::HashSet<String>,
) -> Result<(Catalog, bool), String> {
    transact_with_owner_check(root, mutations, || live_windows.clone())
}
fn transact_with_owner_check(
    root: &Path,
    mutations: &[Value],
    read_live_windows: impl FnOnce() -> std::collections::HashSet<String>,
) -> Result<(Catalog, bool), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join("project-catalog.lock"))
        .map_err(|e| e.to_string())?;
    lock.lock_exclusive()
        .map_err(|e| format!("Cannot lock project catalog: {e}"))?;
    let (previous, recovered) = load(root)?;
    if mutations.is_empty() {
        if recovered {
            atomic_write(
                &root.join("project-catalog.json"),
                &serde_json::to_vec(&previous).map_err(|e| e.to_string())?,
            )?;
        }
        return Ok((previous, recovered));
    }
    // Refresh liveness only after acquiring the same lock used by owner claims.
    let live_windows = read_live_windows();
    let owners = read_owners(root)?;
    for mutation in mutations {
        if mutation["type"] == "removeProject"
            && owners
                .get(mutation["id"].as_str().unwrap_or(""))
                .is_some_and(|owner| live_windows.contains(owner))
        {
            return Err(
                "Close the workspace in its owning window before removing it from the catalog"
                    .into(),
            );
        }
    }
    let mut next = previous.clone();
    for mutation in mutations {
        let mut mutation = mutation.clone();
        if mutation["type"] == "saveContext" {
            if let Some(buffers) = mutation["context"]
                .as_object_mut()
                .and_then(|context| context.remove("recoveryBuffers"))
            {
                let payload = serde_json::json!({"projectId": mutation["id"], "buffers": buffers});
                let bytes = serde_json::to_vec(&payload).map_err(|error| error.to_string())?;
                let reference = format!("{:x}", Sha256::digest(&bytes));
                let directory = root.join("project-contexts");
                fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
                // Immutable payload is durable before the catalog publishes its pointer.
                atomic_write(&directory.join(format!("{reference}.json")), &bytes)?;
                mutation["context"]["recoveryRef"] = Value::String(reference);
            }
        }
        apply(&mut next, &mutation)?;
    }
    // Idempotent requests (re-registering a known project, an unchanged patch) must
    // not rewrite the files or make every window reload the catalog.
    if next == previous {
        if recovered {
            atomic_write(
                &root.join("project-catalog.json"),
                &serde_json::to_vec(&previous).map_err(|e| e.to_string())?,
            )?;
        }
        return Ok((previous, recovered));
    }
    next.revision = previous
        .revision
        .checked_add(1)
        .ok_or("Catalog revision overflow")?;
    // The backup always comes from validated data, including when main was corrupt.
    atomic_write(
        &root.join("project-catalog.backup.json"),
        &serde_json::to_vec(&previous).map_err(|e| e.to_string())?,
    )?;
    atomic_write(
        &root.join("project-catalog.json"),
        &serde_json::to_vec(&next).map_err(|e| e.to_string())?,
    )?;
    // Keep references reachable from the current primary and its last-good backup.
    // Old immutable payloads and failed-transaction orphans are now safe to remove.
    let retained: std::collections::HashSet<_> = next
        .saved_contexts
        .values()
        .chain(previous.saved_contexts.values())
        .filter_map(|context| context.get("recoveryRef").and_then(Value::as_str))
        .collect();
    if let Ok(entries) = fs::read_dir(root.join("project-contexts")) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .extension()
                .is_some_and(|extension| extension == "json")
            {
                if let Some(reference) = path.file_stem().and_then(|name| name.to_str()) {
                    if !retained.contains(reference) {
                        let _ = fs::remove_file(&path);
                    }
                }
            }
        }
    }
    Ok((next, true))
}
#[cfg(test)]
fn transact(root: &Path, mutations: &[Value]) -> Result<Catalog, String> {
    transact_with_status(root, mutations).map(|(catalog, _)| catalog)
}
#[tauri::command]
pub async fn project_catalog_transaction(
    app: tauri::AppHandle,
    mutations: Vec<Value>,
) -> Result<Value, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("spec-ops");
    let owner_app = app.clone();
    let (catalog, changed) = tauri::async_runtime::spawn_blocking(move || {
        transact_with_owner_check(&root, &mutations, || {
            owner_app.webview_windows().into_keys().collect()
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    if changed {
        let _ = app.emit("spec-ops/project-catalog-changed", catalog.revision);
    }
    serde_json::to_value(catalog).map_err(|e| e.to_string())
}

fn read_owners(root: &Path) -> Result<BTreeMap<String, String>, String> {
    match fs::read(root.join("workspace-windows.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| format!("Invalid workspace ownership: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(error) => Err(error.to_string()),
    }
}
fn set_owner(
    root: &Path,
    project: &str,
    owner: Option<String>,
    expected: Option<String>,
    check_expected: bool,
) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join("project-catalog.lock"))
        .map_err(|error| error.to_string())?;
    lock.lock_exclusive().map_err(|error| error.to_string())?;
    let project = identity(project);
    if owner.is_some() && !load(root)?.0.projects.contains_key(&project) {
        return Err("Project was removed from the catalog while opening. Add it again.".into());
    }
    let mut owners = read_owners(root)?;
    if check_expected
        && owners
            .get(&project)
            .is_some_and(|value| Some(value) != expected.as_ref())
    {
        return Err("Workspace ownership changed during the move.".into());
    }
    if let Some(owner) = owner {
        owners.insert(project, owner);
    } else {
        owners.remove(&project);
    }
    atomic_write(
        &root.join("workspace-windows.json"),
        &serde_json::to_vec(&owners).map_err(|error| error.to_string())?,
    )
}
#[tauri::command]
pub async fn project_catalog_set_owner(
    app: tauri::AppHandle,
    root: String,
    window_id: Option<String>,
    expected_owner: Option<String>,
    check_expected: bool,
) -> Result<(), String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("spec-ops");
    tauri::async_runtime::spawn_blocking(move || {
        set_owner(&directory, &root, window_id, expected_owner, check_expected)
    })
    .await
    .map_err(|error| error.to_string())??;
    let _ = app.emit("spec-ops/workspace-placement-changed", ());
    Ok(())
}

fn read_recovery(root: &Path, id: &str, reference: &str) -> Result<Value, String> {
    if reference.len() != 64 || !reference.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid project recovery reference".into());
    }
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join("project-catalog.lock"))
        .map_err(|error| error.to_string())?;
    lock.lock_shared().map_err(|error| error.to_string())?;
    let (catalog, _) = load(root)?;
    if catalog
        .saved_contexts
        .get(id)
        .and_then(|context| context.get("recoveryRef"))
        .and_then(Value::as_str)
        != Some(reference)
    {
        return Err("Project recovery context changed. Try opening again.".into());
    }
    let bytes = fs::read(
        root.join("project-contexts")
            .join(format!("{reference}.json")),
    )
    .map_err(|error| error.to_string())?;
    if format!("{:x}", Sha256::digest(&bytes)) != reference {
        return Err("Project recovery payload is damaged".into());
    }
    let payload: Value = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    if payload["projectId"].as_str() != Some(id) {
        return Err("Project recovery identity mismatch".into());
    }
    Ok(payload["buffers"].clone())
}
#[tauri::command]
pub async fn project_catalog_read_recovery(
    app: tauri::AppHandle,
    id: String,
    reference: String,
) -> Result<Value, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("spec-ops");
    tauri::async_runtime::spawn_blocking(move || read_recovery(&root, &id, &reference))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    struct Temp(std::path::PathBuf);
    impl Temp {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "specops-catalog-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn register(root: &str) -> Value {
        json!({ "type": "register", "project": { "id": identity(root), "rootPath": root, "name": "Project", "folderId": null, "order": 0, "pinned": false, "pinnedOrder": 0, "hiddenFromRail": false, "documentStorage": "app" } })
    }
    #[test]
    fn persists_and_deduplicates_normalized_identity() {
        let temp = Temp::new();
        let result = transact(&temp.0, &[register("/project/"), register("/project")]).unwrap();
        assert_eq!(result.projects.len(), 1);
        assert_eq!(transact(&temp.0, &[]).unwrap().projects.len(), 1);
    }
    #[test]
    fn unchanged_mutations_do_not_write_or_bump_revision() {
        let temp = Temp::new();
        let first = transact_with_status(&temp.0, &[register("/project")]).unwrap();
        assert!(first.1);
        let modified = fs::metadata(temp.0.join("project-catalog.json")).unwrap().modified().unwrap();
        let patch = json!({ "type": "updateProject", "id": "/project", "patch": { "hiddenFromRail": false } });
        let (catalog, changed) = transact_with_status(&temp.0, &[register("/project"), patch]).unwrap();
        assert!(!changed);
        assert_eq!(catalog.revision, first.0.revision);
        assert_eq!(fs::metadata(temp.0.join("project-catalog.json")).unwrap().modified().unwrap(), modified);
    }
    #[test]
    fn concurrent_windows_merge_changes_under_os_lock() {
        let temp = Temp::new();
        let handles: Vec<_> = (0..20)
            .map(|i| {
                let path = temp.0.clone();
                std::thread::spawn(move || {
                    transact(&path, &[register(&format!("/project-{i}"))]).unwrap();
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }
        let result = transact(&temp.0, &[]).unwrap();
        assert_eq!(result.projects.len(), 20);
        assert_eq!(result.revision, 20);
    }
    #[test]
    fn recovers_valid_backup_and_keeps_it_during_next_write() {
        let temp = Temp::new();
        transact(&temp.0, &[register("/first")]).unwrap();
        transact(&temp.0, &[register("/second")]).unwrap();
        fs::write(temp.0.join("project-catalog.json"), "{broken").unwrap();
        let (recovered, changed) = transact_with_status(&temp.0, &[]).unwrap();
        assert!(changed);
        assert_eq!(
            decode(&fs::read(temp.0.join("project-catalog.json")).unwrap())
                .unwrap()
                .revision,
            recovered.revision
        );
        assert!(recovered.projects.contains_key("/first"));
        assert!(recovered.revision > 2);
        transact(&temp.0, &[register("/third")]).unwrap();
        let backup =
            decode(&fs::read(temp.0.join("project-catalog.backup.json")).unwrap()).unwrap();
        assert!(backup.projects.contains_key("/first"));
        assert!(transact(&temp.0, &[])
            .unwrap()
            .projects
            .contains_key("/third"));
    }
    #[test]
    fn rejects_corruption_without_valid_backup_and_never_overwrites() {
        let temp = Temp::new();
        let path = temp.0.join("project-catalog.json");
        fs::write(&path, "{broken").unwrap();
        assert!(transact(&temp.0, &[register("/first")]).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "{broken");
    }
    #[test]
    fn failed_write_preserves_last_whole_catalog() {
        let temp = Temp::new();
        transact(&temp.0, &[register("/first")]).unwrap();
        fs::create_dir(temp.0.join("project-catalog.tmp")).unwrap();
        assert!(transact(&temp.0, &[register("/second")]).is_err());
        let result = transact(&temp.0, &[]).unwrap();
        assert_eq!(result.projects.len(), 1);
        assert!(result.projects.contains_key("/first"));
    }
    #[test]
    fn invalid_multi_update_is_not_partially_committed() {
        let temp = Temp::new();
        assert!(transact(
            &temp.0,
            &[
                register("/first"),
                json!({"type":"updateProject", "id":"/first", "patch":{"id":"/second"}})
            ]
        )
        .is_err());
        assert!(transact(&temp.0, &[]).unwrap().projects.is_empty());
    }
    #[test]
    fn lock_failure_never_degrades_into_unlocked_writes() {
        let temp = Temp::new();
        fs::create_dir(temp.0.join("project-catalog.lock")).unwrap();
        assert!(transact(&temp.0, &[register("/first")]).is_err());
        assert!(!temp.0.join("project-catalog.json").exists());
    }
    #[test]
    fn shared_preferences_appearance_folders_and_context_round_trip() {
        let temp = Temp::new();
        let result = transact(&temp.0, &[register("/first"),
            json!({"type":"putFolder", "folder":{"id":"folder-a", "name":"A", "order":0}}),
            json!({"type":"updateProject", "id":"/first", "patch":{"hiddenFromRail":true, "pinned":true, "folderId":"folder-a", "color":"blue", "icon":"★"}}),
            json!({"type":"saveContext", "id":"/first", "context":{"savedAt":"2026-10-18T12:00:00Z", "snapshot":{"documents":[], "session":{}}}})
        ]).unwrap();
        assert!(result.projects["/first"].hidden_from_rail);
        assert_eq!(result.projects["/first"].extra["color"], "blue");
        assert_eq!(result.saved_contexts.len(), 1);
        let result = transact(&temp.0, &[json!({"type":"removeFolder", "id":"folder-a"})]).unwrap();
        assert!(result.projects["/first"].folder_id.is_none());
    }
    #[test]
    fn semantic_moves_keep_hidden_entries_and_pin_folder_positions() {
        let temp = Temp::new();
        transact(
            &temp.0,
            &[
                register("/a"),
                register("/hidden"),
                register("/b"),
                register("/c"),
                json!({"type":"putFolder","folder":{"id":"folder","name":"Folder","order":0}}),
                json!({"type":"updateProject","id":"/hidden","patch":{"hiddenFromRail":true}}),
                json!({"type":"moveProject","id":"/c","folderId":"folder"}),
            ],
        )
        .unwrap();
        let moved = transact(
            &temp.0,
            &[json!({"type":"moveProject","id":"/b","beforeId":"/a"})],
        )
        .unwrap();
        assert_eq!(
            sorted_projects(&moved, None, false),
            vec!["/b", "/a", "/hidden"]
        );
        let pinned = transact(
            &temp.0,
            &[json!({"type":"moveProject","id":"/a","pinned":true})],
        )
        .unwrap();
        assert_eq!(pinned.projects["/a"].order, moved.projects["/a"].order);
        let unpinned = transact(
            &temp.0,
            &[json!({"type":"moveProject","id":"/a","pinned":false})],
        )
        .unwrap();
        assert_eq!(
            sorted_projects(&unpinned, None, false),
            vec!["/b", "/a", "/hidden"]
        );
        let assigned = transact(
            &temp.0,
            &[
                json!({"type":"moveProject","id":"/a","pinned":true}),
                json!({"type":"moveProject","id":"/a","folderId":"folder"}),
            ],
        )
        .unwrap();
        assert!(assigned.projects["/a"].pinned);
        assert_eq!(
            sorted_projects(&assigned, Some("folder"), false),
            vec!["/c", "/a"]
        );
        let unpinned = transact(
            &temp.0,
            &[json!({"type":"moveProject","id":"/a","pinned":false})],
        )
        .unwrap();
        assert_eq!(
            sorted_projects(&unpinned, Some("folder"), false),
            vec!["/c", "/a"]
        );
        assert_eq!(unpinned.projects["/a"].root_path, "/a");
    }
    #[test]
    fn deleting_folder_appends_projects_in_their_relative_order() {
        let temp = Temp::new();
        let result = transact(
            &temp.0,
            &[
                register("/a"),
                register("/b"),
                register("/c"),
                register("/d"),
                json!({"type":"putFolder","folder":{"id":"folder","name":"Folder","order":0}}),
                json!({"type":"moveProject","id":"/a","folderId":"folder"}),
                json!({"type":"moveProject","id":"/c","folderId":"folder"}),
                json!({"type":"moveProject","id":"/c","folderId":"folder","beforeId":"/a"}),
                json!({"type":"removeFolder","id":"folder"}),
            ],
        )
        .unwrap();
        assert_eq!(
            sorted_projects(&result, None, false),
            vec!["/b", "/d", "/c", "/a"]
        );
        assert_eq!(result.projects.len(), 4);
    }
    #[test]
    fn concurrent_semantic_reorders_merge_membership_and_preferences() {
        let temp = Temp::new();
        transact(
            &temp.0,
            &[
                register("/a"),
                register("/b"),
                register("/hidden"),
                json!({"type":"putFolder","folder":{"id":"one","name":"One","order":0}}),
                json!({"type":"putFolder","folder":{"id":"two","name":"Two","order":1}}),
            ],
        )
        .unwrap();
        let first = temp.0.clone();
        let second = temp.0.clone();
        let a = std::thread::spawn(move || {
            transact(
                &first,
                &[
                    json!({"type":"moveProject","id":"/a","folderId":"one"}),
                    json!({"type":"moveFolder","id":"two","beforeId":"one"}),
                ],
            )
            .unwrap()
        });
        let b = std::thread::spawn(move || {
            transact(
                &second,
                &[
                    json!({"type":"moveProject","id":"/b","folderId":"one"}),
                    json!({"type":"renameFolder","id":"two","name":"Renamed"}),
                    json!({"type":"updateProject","id":"/hidden","patch":{"hiddenFromRail":true}}),
                ],
            )
            .unwrap()
        });
        a.join().unwrap();
        b.join().unwrap();
        let result = transact(&temp.0, &[]).unwrap();
        assert_eq!(sorted_projects(&result, Some("one"), false).len(), 2);
        assert!(result.projects["/hidden"].hidden_from_rail);
        assert_eq!(result.folders["two"].name, "Renamed");
        assert!(result.folders["two"].order < result.folders["one"].order);
    }
    #[test]
    fn recovery_payload_is_durable_and_never_returned_in_catalog() {
        let temp = Temp::new();
        let saved = json!({"type":"saveContext","id":"/project","context":{"savedAt":"now","snapshot":{"documents":[{"id":"doc-1","filePath":null}],"session":{}},"recoveryBuffers":{"doc-1":{"content":"draft","savedContent":"","isDirty":true}}}});
        let catalog = transact(&temp.0, &[register("/project"), saved]).unwrap();
        let context = &catalog.saved_contexts["/project"];
        assert!(context.get("recoveryBuffers").is_none());
        let reference = context["recoveryRef"].as_str().unwrap();
        assert_eq!(
            read_recovery(&temp.0, "/project", reference).unwrap()["doc-1"]["content"],
            "draft"
        );
        fs::write(
            temp.0
                .join("project-contexts")
                .join(format!("{reference}.json")),
            b"corrupt",
        )
        .unwrap();
        assert!(read_recovery(&temp.0, "/project", reference)
            .unwrap_err()
            .contains("damaged"));
    }
    #[test]
    fn recovery_failure_keeps_previous_pointer_and_gc_retains_backup_payload() {
        let temp = Temp::new();
        transact(&temp.0, &[register("/project")]).unwrap();
        for number in 0..5 {
            transact(&temp.0, &[json!({"type":"saveContext","id":"/project","context":{"savedAt":"now","snapshot":{"documents":[],"session":{}},"recoveryBuffers":{"doc":{"content":number}}}})]).unwrap();
        }
        assert_eq!(
            fs::read_dir(temp.0.join("project-contexts"))
                .unwrap()
                .count(),
            2
        );
        let before = fs::read(temp.0.join("project-catalog.json")).unwrap();
        fs::remove_dir_all(temp.0.join("project-contexts")).unwrap();
        fs::write(temp.0.join("project-contexts"), b"not a directory").unwrap();
        assert!(transact(&temp.0, &[json!({"type":"saveContext","id":"/project","context":{"savedAt":"now","snapshot":{"documents":[],"session":{}},"recoveryBuffers":{"doc":{"content":"new"}}}})]).is_err());
        assert_eq!(
            fs::read(temp.0.join("project-catalog.json")).unwrap(),
            before
        );
    }
    #[test]
    fn remove_and_owner_claim_are_serialized_without_open_uncatalogued_projects() {
        let temp = Temp::new();
        transact(&temp.0, &[register("/project")]).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let path = temp.0.clone();
        let waiting = barrier.clone();
        let claim = std::thread::spawn(move || {
            waiting.wait();
            set_owner(&path, "/project", Some("main".into()), None, true)
        });
        barrier.wait();
        let remove = transact_with_windows(
            &temp.0,
            &[json!({"type":"removeProject","id":"/project"})],
            &std::collections::HashSet::from(["main".into()]),
        );
        let claimed = claim.join().unwrap();
        assert_ne!(claimed.is_ok(), remove.is_ok());
        if claimed.is_ok() {
            assert!(transact(&temp.0, &[])
                .unwrap()
                .projects
                .contains_key("/project"));
        }
    }
    #[test]
    fn metadata_codec_rejects_embedded_file_buffers_and_discard_clears_recovery_pointer() {
        let temp = Temp::new();
        transact(&temp.0, &[register("/project")]).unwrap();
        assert!(transact(&temp.0, &[json!({"type":"saveContext","id":"/project","context":{"savedAt":"now","snapshot":{"documents":[{"content":"secret"}],"session":{}}}})]).is_err());
        let result = transact(&temp.0, &[json!({"type":"saveContext","id":"/project","context":{"savedAt":"now","snapshot":{"documents":[],"session":{}}}})]).unwrap();
        assert!(result.saved_contexts["/project"]
            .get("recoveryRef")
            .is_none());
    }

    #[test]
    fn removal_refreshes_window_liveness_after_waiting_for_the_catalog_lock() {
        let temp = Temp::new();
        transact(&temp.0, &[register("/project")]).unwrap();
        let held = OpenOptions::new()
            .read(true)
            .write(true)
            .open(temp.0.join("project-catalog.lock"))
            .unwrap();
        held.lock_exclusive().unwrap();
        let live = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let next_live = live.clone();
        let directory = temp.0.clone();
        let remove = std::thread::spawn(move || {
            transact_with_owner_check(
                &directory,
                &[json!({"type":"removeProject","id":"/project"})],
                || {
                    // A separately opened lock must still be held while querying liveness.
                    let lock = OpenOptions::new()
                        .read(true)
                        .write(true)
                        .open(directory.join("project-catalog.lock"))
                        .unwrap();
                    assert!(lock.try_lock_exclusive().is_err());
                    if next_live.load(Ordering::SeqCst) {
                        std::collections::HashSet::from(["new-window".into()])
                    } else {
                        std::collections::HashSet::new()
                    }
                },
            )
        });
        atomic_write(
            &temp.0.join("workspace-windows.json"),
            br#"{"/project":"new-window"}"#,
        )
        .unwrap();
        live.store(true, Ordering::SeqCst);
        FileExt::unlock(&held).unwrap();
        assert!(remove
            .join()
            .unwrap()
            .unwrap_err()
            .contains("owning window"));
        assert!(transact(&temp.0, &[])
            .unwrap()
            .projects
            .contains_key("/project"));
    }
}
