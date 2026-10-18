//! App-wide project catalog transactions. The OS releases the advisory lock on
//! process death; no timeout or frontend watchdog can permit concurrent writers.
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::Write,
    path::Path,
};
use tauri::{Emitter, Manager};

#[derive(Clone, Debug, Deserialize, Serialize)]
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
#[derive(Clone, Debug, Deserialize, Serialize)]
struct Folder {
    id: String,
    name: String,
    order: f64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
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
        "putFolder" => {
            let folder: Folder =
                serde_json::from_value(mutation["folder"].clone()).map_err(|e| e.to_string())?;
            c.folders.insert(folder.id.clone(), folder);
        }
        "removeFolder" => {
            c.folders.remove(id);
            for p in c.projects.values_mut() {
                if p.folder_id.as_deref() == Some(id) {
                    p.folder_id = None;
                }
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
fn transact_with_status(root: &Path, mutations: &[Value]) -> Result<(Catalog, bool), String> {
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
    let mut next = previous.clone();
    for mutation in mutations {
        apply(&mut next, mutation)?;
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
    let (catalog, changed) =
        tauri::async_runtime::spawn_blocking(move || transact_with_status(&root, &mutations))
            .await
            .map_err(|e| e.to_string())??;
    if changed {
        let _ = app.emit("spec-ops/project-catalog-changed", catalog.revision);
    }
    serde_json::to_value(catalog).map_err(|e| e.to_string())
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
}
