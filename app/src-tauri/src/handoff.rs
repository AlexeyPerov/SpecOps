//! Bounded workspace excerpts and strict durable handoff intent writes.
use serde::Serialize;
#[cfg(unix)]
use nix::libc;
use std::{fs, io::{Read, Write}, path::{Component, Path, PathBuf}};
use tauri::Manager;

fn private_path(path: &str) -> bool {
    path.replace('\\', "/").split('/').any(|part| {
        let p = part.to_ascii_lowercase();
        p.starts_with('.') || p.contains("secret") || p.contains("credential") || p.contains("password") || p.contains("token") || p == "auth" || p.starts_with("auth.") || (p.starts_with("api-key") || p.starts_with("api_key")) || p.starts_with("id_") || ["pem", "key", "p12", "pfx", "keystore"].iter().any(|ext| p.ends_with(&format!(".{ext}")))
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Excerpt { path: String, text: Option<String>, state: &'static str }

fn excerpts(root: &Path, paths: Vec<String>) -> Result<Vec<Excerpt>, String> {
    let root = root.canonicalize().map_err(|_| "Workspace unavailable")?;
    let mut paths = paths;
    paths.sort(); paths.dedup();
    if paths.len() > 32 { return Err("Too many excerpt paths".into()); }
    let mut out = vec![];
    for path in paths {
        let relative = Path::new(&path);
        let safe = !path.is_empty() && path.len() <= 1024 && !private_path(&path) && relative.components().all(|c| matches!(c, Component::Normal(_)));
        let mut entry = Excerpt { path: path.clone(), text: None, state: "excluded" };
        if safe {
            entry.state = "unavailable";
            #[cfg(unix)] {
                if let Ok(file) = anchored_file(&root, relative, false) {
                    if file.metadata().is_ok_and(|m| m.is_file()) {
                        let mut bytes = vec![];
                        if file.take(8193).read_to_end(&mut bytes).is_ok() {
                            let truncated = bytes.len() > 8192; bytes.truncate(8192);
                            if !bytes.contains(&0) {
                                if let Ok(text) = String::from_utf8(bytes) { entry.text = Some(text); entry.state = if truncated { "truncated" } else { "included" }; }
                            }
                        }
                    }
                }
            }
            // Other platforms report missing evidence until a handle-relative,
            // no-reparse-point reader has been verified there.
        }
        out.push(entry);
    }
    Ok(out)
}

#[tauri::command(async)]
pub async fn handoff_workspace_excerpts(workspace_root: String, paths: Vec<String>) -> Result<Vec<Excerpt>, String> {
    tauri::async_runtime::spawn_blocking(move || excerpts(Path::new(&workspace_root), paths)).await.map_err(|_| "Excerpt task failed".to_string())?
}

#[cfg(unix)]
fn anchored_file(root: &Path, relative: &Path, directory: bool) -> std::io::Result<fs::File> {
    use std::os::{fd::{AsRawFd, FromRawFd}, unix::fs::OpenOptionsExt};
    let mut options = fs::OpenOptions::new(); options.read(true).custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW);
    let mut current = if root == Path::new("/") { options.open(root)? } else { anchored_file(Path::new("/"), root.strip_prefix("/").map_err(|_| std::io::ErrorKind::InvalidInput)?, true)? };
    let components: Vec<_> = relative.components().collect();
    for (index, component) in components.iter().enumerate() {
        let Component::Normal(name) = component else { return Err(std::io::Error::from(std::io::ErrorKind::InvalidInput)); };
        use std::os::unix::ffi::OsStrExt;
        let name = std::ffi::CString::new(name.as_bytes()).map_err(|_| std::io::ErrorKind::InvalidInput)?;
        let flags = libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | if directory || index + 1 < components.len() { libc::O_DIRECTORY } else { libc::O_NONBLOCK };
        let fd = unsafe { libc::openat(current.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 { return Err(std::io::Error::last_os_error()); }
        current = unsafe { fs::File::from_raw_fd(fd) };
    }
    Ok(current)
}
#[cfg(unix)]
fn strict_journal(path: &Path, content: &str, expected: Option<String>) -> Result<(), String> {
    use std::os::fd::{AsRawFd, FromRawFd};
    let relative = path.strip_prefix("/").map_err(|_| "Journal path must be absolute")?;
    let parent = anchored_file(Path::new("/"), relative.parent().ok_or("Journal directory unavailable")?, true).map_err(|_| "Journal directory is unavailable or contains symlinks")?;
    let name = std::ffi::CString::new("handoffs.json").unwrap();
    let lock_name = std::ffi::CString::new("handoffs.lock").unwrap();
    let lock_fd = unsafe { libc::openat(parent.as_raw_fd(), lock_name.as_ptr(), libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC, 0o600) };
    if lock_fd < 0 { return Err("Handoff journal is locked; inspect interrupted attempt".into()); }
    let lock = unsafe { fs::File::from_raw_fd(lock_fd) };
    let result = (|| {
        let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC) };
        let current = if fd >= 0 {
            let file = unsafe { fs::File::from_raw_fd(fd) };
            if !file.metadata().map_err(|_| "Could not inspect journal")?.is_file() { return Err("Invalid journal file".into()); }
            let mut raw = String::new(); file.take(1_048_577).read_to_string(&mut raw).map_err(|_| "Could not read journal")?; Some(raw)
        } else if std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound { None }
        else { return Err("Could not safely read handoff journal".into()); };
        if current != expected { return Err("Handoff journal changed; reload before continuing".into()); }
        let temp = std::ffi::CString::new(format!(".handoff-{}-{}.tmp", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "Clock unavailable")?.as_nanos())).unwrap();
        let fd = unsafe { libc::openat(parent.as_raw_fd(), temp.as_ptr(), libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC, 0o600) };
        if fd < 0 { return Err("Could not create journal temporary file".into()); }
        let mut file = unsafe { fs::File::from_raw_fd(fd) };
        let write = (|| -> std::io::Result<()> {
            file.write_all(content.as_bytes())?; file.sync_all()?;
            if unsafe { libc::renameat(parent.as_raw_fd(), temp.as_ptr(), parent.as_raw_fd(), name.as_ptr()) } != 0 { return Err(std::io::Error::last_os_error()); }
            parent.sync_all()?; Ok(())
        })();
        unsafe { libc::unlinkat(parent.as_raw_fd(), temp.as_ptr(), 0); }
        write.map_err(|_| "Could not durably save handoff intent".into())
    })();
    drop(lock); unsafe { libc::unlinkat(parent.as_raw_fd(), lock_name.as_ptr(), 0); }
    result
}
#[cfg(not(unix))]
fn strict_journal(_path: &Path, _content: &str, _expected: Option<String>) -> Result<(), String> {
    Err("Durable handoff intent storage is unavailable on this platform".into())
}

#[cfg(unix)]
fn read_journal(path: &Path) -> Result<Option<String>, String> {
    let parent = anchored_file(Path::new("/"), path.parent().ok_or("Journal directory unavailable")?.strip_prefix("/").map_err(|_| "Journal path must be absolute")?, true).map_err(|_| "Journal directory unavailable or unsafe")?;
    use std::os::fd::{AsRawFd, FromRawFd};
    let name = std::ffi::CString::new("handoffs.json").unwrap();
    let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC) };
    if fd < 0 { return if std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound { Ok(None) } else { Err("Could not safely read journal".into()) }; }
    let file = unsafe { fs::File::from_raw_fd(fd) };
    let meta = file.metadata().map_err(|_| "Could not inspect journal")?;
    if !meta.is_file() || meta.len() > 1_048_576 { return Err("Invalid or oversized journal".into()); }
    let mut content = String::new(); file.take(1_048_577).read_to_string(&mut content).map_err(|_| "Could not read journal")?;
    if content.len() > 1_048_576 { return Err("Journal exceeds its limit".into()); }
    Ok(Some(content))
}
#[cfg(not(unix))]
fn read_journal(_path: &Path) -> Result<Option<String>, String> { Err("Safe handoff storage unavailable on this platform".into()) }
fn journal_path(app: &tauri::AppHandle, path: String) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|_| "App data unavailable")?.join("spec-ops").join("chat");
    let target = PathBuf::from(path);
    if !target.starts_with(&base) || target.file_name().and_then(|n| n.to_str()) != Some("handoffs.json") || target.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) { return Err("Invalid handoff journal scope".into()); }
    Ok(target)
}
#[tauri::command(async)]
pub async fn handoff_read_journal(app: tauri::AppHandle, path: String) -> Result<Option<String>, String> {
    let path = journal_path(&app, path)?;
    tauri::async_runtime::spawn_blocking(move || read_journal(&path)).await.map_err(|_| "Journal read task failed".to_string())?
}

#[tauri::command(async)]
pub async fn handoff_write_journal(app: tauri::AppHandle, path: String, content: String, expected: Option<String>) -> Result<(), String> {
    if content.len() > 1_048_576 || expected.as_ref().is_some_and(|s| s.len() > 1_048_576) { return Err("Journal size exceeded".into()); }
    let target = journal_path(&app, path)?;
    tauri::async_runtime::spawn_blocking(move || strict_journal(&target, &content, expected)).await.map_err(|_| "Journal task failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn excludes_private_traversal_binary_and_bounds() {
        let root = std::env::temp_dir().join(format!("specops-handoff-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("safe.txt"), "a".repeat(9000)).unwrap();
        fs::write(root.join(".env"), "CANARY_PRIVATE").unwrap();
        fs::write(root.join("binary"), [0, 1]).unwrap();
        let values = excerpts(&root, vec!["safe.txt".into(), ".env".into(), "../outside".into(), "missing".into(), "binary".into()]).unwrap();
        assert!(values.iter().all(|e| !e.text.as_deref().unwrap_or("").contains("CANARY_PRIVATE")));
        assert_eq!(values.iter().find(|e| e.path == "safe.txt").unwrap().state, "truncated");
        #[cfg(unix)] { std::os::unix::fs::symlink(root.join("safe.txt"), root.join("link")).unwrap(); assert!(excerpts(&root, vec!["link".into()]).unwrap()[0].text.is_none()); }
        let root = root.canonicalize().unwrap();
        strict_journal(&root.join("handoffs.json"), "first", None).unwrap(); strict_journal(&root.join("handoffs.json"), "second", Some("first".into())).unwrap();
        assert!(strict_journal(&root.join("handoffs.json"), "third", Some("first".into())).is_err());
        assert_eq!(fs::read_to_string(root.join("handoffs.json")).unwrap(), "second");
        #[cfg(unix)] {
            fs::create_dir(root.join("nested")).unwrap();
            std::os::unix::fs::symlink(root.join("nested"), root.join("parent-link")).unwrap();
            assert!(strict_journal(&root.join("parent-link/handoffs.json"), "unsafe", None).is_err());
            fs::remove_file(root.join("handoffs.json")).unwrap();
            std::os::unix::fs::symlink(root.join("safe.txt"), root.join("handoffs.json")).unwrap();
            assert!(read_journal(&root.join("handoffs.json")).is_err());
            assert!(strict_journal(&root.join("handoffs.json"), "unsafe", None).is_err());
            fs::remove_file(root.join("handoffs.json")).unwrap();
            let a = root.join("handoffs.json"); let b = a.clone();
            let first = std::thread::spawn(move || strict_journal(&a, "one", None));
            let second = std::thread::spawn(move || strict_journal(&b, "two", None));
            assert_ne!(first.join().unwrap().is_ok(), second.join().unwrap().is_ok());
        }
        fs::remove_dir_all(root).unwrap();
    }
}
