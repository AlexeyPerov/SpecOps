//! Global and workspace documents are stored independently of editor sessions.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager};
static DOCUMENT_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDocument {
    path: String,
    content: Option<String>,
}

fn document_path(
    app: &tauri::AppHandle,
    root: Option<&str>,
    storage: &str,
    kind: &str,
) -> Result<PathBuf, String> {
    document_path_at(
        &app.path().app_data_dir().map_err(|e| e.to_string())?,
        root,
        storage,
        kind,
    )
}

fn document_path_at(
    data: &Path,
    root: Option<&str>,
    storage: &str,
    kind: &str,
) -> Result<PathBuf, String> {
    if !matches!(kind, "tasks" | "notes") {
        return Err("Unknown workspace document.".into());
    }
    let filename = if kind == "tasks" {
        "tasks.json"
    } else {
        "notes.md"
    };
    let target = if let Some(root) = root {
        let path = PathBuf::from(root);
        if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
            return Err("Invalid workspace root.".into());
        }
        let root = fs::canonicalize(path).map_err(|e| e.to_string())?;
        if !root.is_dir() {
            return Err("Workspace root is not a folder.".into());
        }
        match storage {
            "project" => {
                let directory = root.join(".specops");
                if fs::symlink_metadata(&directory)
                    .is_ok_and(|m| m.file_type().is_symlink() || !m.is_dir())
                {
                    return Err("Document directory must be a regular folder.".into());
                }
                directory.join(filename)
            }
            "app" => {
                let key = root.to_string_lossy().replace('\\', "/");
                #[cfg(any(target_os = "macos", windows))]
                let key = key.to_lowercase();
                let hash = format!("{:x}", Sha256::digest(key.as_bytes()));
                data.join("spec-ops/workspace-documents")
                    .join(hash)
                    .join(filename)
            }
            _ => return Err("Unknown workspace storage.".into()),
        }
    } else {
        if storage != "app" {
            return Err("Global documents use application storage.".into());
        }
        data.join("spec-ops/global-documents").join(filename)
    };
    if fs::symlink_metadata(&target).is_ok_and(|m| m.file_type().is_symlink() || !m.is_file()) {
        return Err("Workspace document must be a regular file.".into());
    }
    Ok(target)
}
fn validate_document(kind: &str, content: &str) -> Result<(), String> {
    if kind != "tasks" {
        return Ok(());
    }
    let invalid = || {
        "Invalid task document: expected version 1, unique IDs and valid references.".to_string()
    };
    let value: serde_json::Value = serde_json::from_str(content).map_err(|_| invalid())?;
    if value["version"].as_u64() != Some(1) {
        return Err(invalid());
    }
    let groups = value["groups"].as_array().ok_or_else(invalid)?;
    let lists = value["lists"].as_array().ok_or_else(invalid)?;
    let tasks = value["tasks"].as_array().ok_or_else(invalid)?;
    let mut ids = std::collections::HashSet::new();
    let mut group_ids = std::collections::HashSet::new();
    let mut list_ids = std::collections::HashSet::new();
    let nonempty = |v: &serde_json::Value| v.as_str().is_some_and(|s| !s.trim().is_empty());
    for item in groups.iter().chain(lists).chain(tasks) {
        if !nonempty(&item["id"]) || !ids.insert(item["id"].as_str().unwrap()) {
            return Err(invalid());
        }
    }
    for group in groups {
        if !nonempty(&group["title"]) {
            return Err(invalid());
        }
        group_ids.insert(group["id"].as_str().unwrap());
    }
    for list in lists {
        if !nonempty(&list["title"])
            || list.get("groupId").is_none()
            || (!list["groupId"].is_null()
                && !list["groupId"]
                    .as_str()
                    .is_some_and(|id| group_ids.contains(id)))
        {
            return Err(invalid());
        }
        list_ids.insert(list["id"].as_str().unwrap());
    }
    for task in tasks {
        if !nonempty(&task["text"])
            || !task["completed"].is_boolean()
            || !task["listId"]
                .as_str()
                .is_some_and(|id| list_ids.contains(id))
        {
            return Err(invalid());
        }
    }
    Ok(())
}

fn read(path: &PathBuf) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}
fn save(path: &PathBuf, content: &str, expected: Option<&str>) -> Result<(), String> {
    use std::io::Write;
    if read(path)?.as_deref() != expected {
        return Err(
            "Document changed on disk. Reload or resolve the conflict before saving.".into(),
        );
    }
    let parent = path.parent().ok_or("Document has no parent")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp = parent.join(format!(
        ".workspace-document-{}-{}.tmp",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let operation = (|| -> std::io::Result<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        // Recheck immediately before publication; never truncate the previous contents on write failure.
        if read(path).map_err(std::io::Error::other)?.as_deref() != expected {
            return Err(std::io::Error::other(
                "Document changed on disk while saving.",
            ));
        }
        if expected.is_none() {
            fs::hard_link(&temp, path)?;
            fs::remove_file(&temp)
        } else {
            fs::rename(&temp, path)
        }
    })();
    if operation.is_err() {
        let _ = fs::remove_file(temp);
    }
    operation.map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub async fn workspace_document_read(
    app: tauri::AppHandle,
    root: Option<String>,
    storage: String,
    kind: String,
) -> Result<WorkspaceDocument, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = DOCUMENT_LOCK.lock().map_err(|e| e.to_string())?;
        let path = document_path(&app, root.as_deref(), &storage, &kind)?;
        Ok(WorkspaceDocument {
            content: read(&path)?,
            path: path.to_string_lossy().into_owned(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command(async)]
pub async fn workspace_document_save(
    app: tauri::AppHandle,
    root: Option<String>,
    storage: String,
    kind: String,
    content: String,
    expected: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = DOCUMENT_LOCK.lock().map_err(|e| e.to_string())?;
        validate_document(&kind, &content)?;
        let path = document_path(&app, root.as_deref(), &storage, &kind)?;
        save(&path, &content, expected.as_deref())?;
        let _ = app.emit(
            "workspace-document-changed",
            serde_json::json!({ "path": path.to_string_lossy() }),
        );
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command(async)]
pub async fn workspace_documents_transfer(
    app: tauri::AppHandle,
    root: Option<String>,
    source: String,
    target: String,
    replace: bool,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = DOCUMENT_LOCK.lock().map_err(|e| e.to_string())?;
        if root.is_none() {
            return Err("Global documents cannot be moved into a workspace.".into());
        }
        if source == target {
            return Err("Choose a different storage location.".into());
        }
        let mut documents = Vec::new();
        for kind in ["tasks", "notes"] {
            let from = document_path(&app, root.as_deref(), &source, kind)?;
            if let Some(content) = read(&from)? {
                validate_document(kind, &content)?;
                let to = document_path(&app, root.as_deref(), &target, kind)?;
                let previous = read(&to)?;
                if previous.is_some() && !replace {
                    return Err("Destination documents already exist.".into());
                }
                documents.push((from, to, content, previous));
            }
        }
        for (index, (_, to, content, previous)) in documents.iter().enumerate() {
            if let Err(error) = save(to, content, previous.as_deref()) {
                // Roll back published destinations. Sources have not been removed yet.
                for (_, written, value, original) in &documents[..index] {
                    if let Some(original) = original {
                        let _ = save(written, original, Some(value));
                    } else {
                        let _ = fs::remove_file(written);
                    }
                }
                return Err(error);
            }
        }
        for (_, to, _, _) in &documents {
            let _ = app.emit(
                "workspace-document-changed",
                serde_json::json!({ "path": to.to_string_lossy() }),
            );
        }
        // External edits made during the copy remain at the source.
        for (from, _, content, _) in &documents {
            if read(from)?.as_deref() != Some(content.as_str()) {
                return Ok(Some(
                    "Documents copied; source files changed during transfer and were kept.".into(),
                ));
            }
        }
        let mut warnings = Vec::new();
        for (from, _, _, _) in documents {
            if let Err(error) = fs::remove_file(&from) {
                warnings.push(format!("Source retained at {}: {error}", from.display()));
            }
        }
        Ok(if warnings.is_empty() {
            None
        } else {
            Some(warnings.join("\n"))
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compare_before_write_and_lazy_creation() {
        let dir = std::env::temp_dir().join(format!("spec-ops-doc-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join("notes.md");
        assert_eq!(read(&path).unwrap(), None);
        assert!(!dir.exists());
        save(&path, "- [ ] First\n", None).unwrap();
        assert!(save(&path, "bad", None).is_err());
        fs::write(&path, "external").unwrap();
        assert!(save(&path, "bad", Some("- [ ] First\n")).is_err());
        assert_eq!(read(&path).unwrap().as_deref(), Some("external"));
        save(&path, "resolved", Some("external")).unwrap();
        assert_eq!(read(&path).unwrap().as_deref(), Some("resolved"));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn document_scopes_and_formats_are_separate_and_lazy() {
        let dir = std::env::temp_dir().join(format!("spec-ops-doc-scope-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let root = dir.join("project");
        let data = dir.join("data");
        fs::create_dir_all(&root).unwrap();
        let canonical = fs::canonicalize(&root).unwrap();
        let project = document_path_at(&data, root.to_str(), "project", "tasks").unwrap();
        assert_eq!(project, canonical.join(".specops/tasks.json"));
        let global = document_path_at(&data, None, "app", "tasks").unwrap();
        assert!(global.ends_with("global-documents/tasks.json"));
        let local = document_path_at(&data, root.to_str(), "app", "tasks").unwrap();
        assert_ne!(global, local);
        assert!(!data.exists());
        assert!(!canonical.join(".specops").exists());
        assert!(document_path_at(&data, None, "project", "tasks").is_err());
        assert!(document_path_at(&data, Some("relative"), "app", "notes").is_err());
        assert!(document_path_at(&data, None, "app", "unknown").is_err());
        let notes = document_path_at(&data, root.to_str(), "project", "notes").unwrap();
        assert!(notes.ends_with(".specops/notes.md"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn project_document_directory_cannot_be_a_symlink() {
        let dir = std::env::temp_dir().join(format!("spec-ops-doc-link-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("project")).unwrap();
        fs::create_dir_all(dir.join("elsewhere")).unwrap();
        std::os::unix::fs::symlink(dir.join("elsewhere"), dir.join("project/.specops")).unwrap();
        assert!(document_path_at(&dir, dir.join("project").to_str(), "project", "tasks").is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn structured_tasks_validate_before_publication() {
        let valid = serde_json::json!({ "version": 1, "groups": [{"id":"g", "title":"Work"}],
            "lists": [{"id":"l", "title":"Plan", "groupId":"g"}],
            "tasks": [{"id":"t", "listId":"l", "text":"Start", "completed":false}] });
        assert!(validate_document("tasks", &valid.to_string()).is_ok());
        for (field, replacement) in [
            ("version", serde_json::json!(2)),
            ("groups", serde_json::json!([])),
            ("lists", serde_json::json!([])),
            (
                "tasks",
                serde_json::json!([{ "id":"g", "listId":"l", "text":"Start", "completed":false }]),
            ),
        ] {
            let mut invalid = valid.clone();
            invalid[field] = replacement;
            assert!(validate_document("tasks", &invalid.to_string()).is_err());
        }
        assert!(validate_document("tasks", "bad JSON").is_err());
        assert!(validate_document("notes", "# Any plain text").is_ok());
    }
}
