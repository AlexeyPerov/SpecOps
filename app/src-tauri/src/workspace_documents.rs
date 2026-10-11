//! Workspace Markdown documents are stored independently of editor sessions.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Component, PathBuf},
    sync::Mutex,
};
use tauri::Manager;
static DOCUMENT_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDocument {
    path: String,
    content: Option<String>,
}

fn document_path(
    app: &tauri::AppHandle,
    root: &str,
    storage: &str,
    kind: &str,
) -> Result<PathBuf, String> {
    if !matches!(kind, "tasks" | "notes") {
        return Err("Unknown workspace document.".into());
    }
    let path = PathBuf::from(root);
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Invalid workspace root.".into());
    }
    let root = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !root.is_dir() {
        return Err("Workspace root is not a folder.".into());
    }
    let target = match storage {
        "project" => root.join(format!(".spec-ops-{kind}.md")),
        "app" => {
            let key = root.to_string_lossy().replace('\\', "/");
            #[cfg(any(target_os = "macos", windows))]
            let key = key.to_lowercase();
            let hash = format!("{:x}", Sha256::digest(key.as_bytes()));
            app.path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .join("spec-ops/workspace-documents")
                .join(hash)
                .join(format!("{kind}.md"))
        }
        _ => return Err("Unknown workspace storage.".into()),
    };
    if fs::symlink_metadata(&target).is_ok_and(|m| m.file_type().is_symlink() || !m.is_file()) {
        return Err("Workspace document must be a regular file.".into());
    }
    Ok(target)
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
    root: String,
    storage: String,
    kind: String,
) -> Result<WorkspaceDocument, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = DOCUMENT_LOCK.lock().map_err(|e| e.to_string())?;
        let path = document_path(&app, &root, &storage, &kind)?;
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
    root: String,
    storage: String,
    kind: String,
    content: String,
    expected: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = DOCUMENT_LOCK.lock().map_err(|e| e.to_string())?;
        save(
            &document_path(&app, &root, &storage, &kind)?,
            &content,
            expected.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command(async)]
pub async fn workspace_documents_transfer(
    app: tauri::AppHandle,
    root: String,
    source: String,
    target: String,
    replace: bool,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = DOCUMENT_LOCK.lock().map_err(|e| e.to_string())?;
        if source == target {
            return Err("Choose a different storage location.".into());
        }
        let mut documents = Vec::new();
        for kind in ["tasks", "notes"] {
            let from = document_path(&app, &root, &source, kind)?;
            if let Some(content) = read(&from)? {
                let to = document_path(&app, &root, &target, kind)?;
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
        let path = dir.join("tasks.md");
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
}
