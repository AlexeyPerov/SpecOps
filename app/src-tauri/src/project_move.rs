//! User-requested project moves, including destinations on other volumes.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

static MOVE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveResult {
    status: &'static str,
    path: String,
    can_replace: bool,
    warning: Option<String>,
}

fn absolute(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Choose an absolute path without parent traversal.".into());
    }
    Ok(path)
}

fn present(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}
fn remove_entry(path: &Path) -> io::Result<()> {
    if fs::symlink_metadata(path)?.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}
fn sibling(path: &Path, tag: &str) -> PathBuf {
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    path.with_file_name(format!(
        ".spec-ops-{tag}-{}-{nanos}-{sequence}",
        std::process::id()
    ))
}

// Refuse replacement even if an external process creates the destination after our check.
fn rename_new(source: &Path, target: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let from = std::ffi::CString::new(source.as_os_str().as_bytes())?;
        let to = std::ffi::CString::new(target.as_os_str().as_bytes())?;
        #[cfg(target_os = "macos")]
        let result =
            unsafe { nix::libc::renamex_np(from.as_ptr(), to.as_ptr(), nix::libc::RENAME_EXCL) };
        #[cfg(target_os = "linux")]
        let result = unsafe {
            nix::libc::renameat2(
                nix::libc::AT_FDCWD,
                from.as_ptr(),
                nix::libc::AT_FDCWD,
                to.as_ptr(),
                nix::libc::RENAME_NOREPLACE,
            )
        };
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        return if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        };
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        if present(target) {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "Destination already exists",
            ));
        }
        fs::rename(source, target)
    }
}

fn hash(path: &Path) -> io::Result<Vec<u8>> {
    let mut input = fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = input.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(digest.finalize().to_vec())
}

fn copy_entry(source: &Path, target: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(source)?;
    if metadata.file_type().is_symlink() {
        let link = fs::read_link(source)?;
        #[cfg(unix)]
        std::os::unix::fs::symlink(link, target)?;
        #[cfg(windows)]
        if source.is_dir() {
            std::os::windows::fs::symlink_dir(link, target)?;
        } else {
            std::os::windows::fs::symlink_file(link, target)?;
        }
    } else if metadata.is_dir() {
        fs::create_dir(target)?;
        for child in fs::read_dir(source)? {
            let child = child?;
            copy_entry(&child.path(), &target.join(child.file_name()))?;
        }
        fs::set_permissions(target, metadata.permissions())?;
    } else if metadata.is_file() {
        // create_new makes staging immune to accidentally replacing another file.
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)?;
        io::copy(&mut fs::File::open(source)?, &mut output)?;
        output.sync_all()?;
        fs::set_permissions(target, metadata.permissions())?;
    } else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Cannot copy this filesystem entry",
        ));
    }
    Ok(())
}

fn verify_copy(source: &Path, target: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(source)?;
    let matches = if metadata.file_type().is_symlink() {
        fs::read_link(source)? == fs::read_link(target)?
    } else if metadata.is_dir() {
        let mut source_names = fs::read_dir(source)?
            .map(|e| e.map(|e| e.file_name()))
            .collect::<io::Result<Vec<_>>>()?;
        let mut target_names = fs::read_dir(target)?
            .map(|e| e.map(|e| e.file_name()))
            .collect::<io::Result<Vec<_>>>()?;
        source_names.sort();
        target_names.sort();
        if source_names != target_names {
            return Err(io::Error::other(
                "Folder changed during copying; source kept",
            ));
        }
        for name in source_names {
            verify_copy(&source.join(&name), &target.join(name))?;
        }
        true
    } else {
        metadata.len() == fs::metadata(target)?.len() && hash(source)? == hash(target)?
    };
    if matches {
        Ok(())
    } else {
        Err(io::Error::other("Copy verification failed; source kept"))
    }
}

fn move_entry(
    source: &Path,
    target: &Path,
    replace: bool,
    force_copy: bool,
) -> Result<Option<String>, String> {
    let backup = sibling(target, "replaced");
    if replace {
        rename_new(target, &backup).map_err(|e| e.to_string())?;
    }
    let operation = (|| -> io::Result<Option<String>> {
        if !force_copy {
            match rename_new(source, target) {
                Ok(()) => return Ok(None),
                Err(error)
                    if error.raw_os_error() == Some(18)
                        || error.raw_os_error() == Some(17) && cfg!(windows) => {}
                Err(error) => return Err(error),
            }
        }
        let stage = sibling(target, "moving");
        let copied = (|| -> io::Result<()> {
            copy_entry(source, &stage)?;
            verify_copy(source, &stage)?;
            rename_new(&stage, target)
        })();
        if let Err(error) = copied {
            let _ = remove_entry(&stage);
            return Err(error);
        }
        // A failed source removal never deletes the verified destination.
        Ok(remove_entry(source)
            .err()
            .map(|e| format!("Copied successfully, but source could not be fully removed: {e}")))
    })();
    match operation {
        Ok(mut warning) => {
            if replace {
                if let Err(error) = remove_entry(&backup) {
                    warning = Some(format!(
                        "Move completed; replaced item retained at {}: {error}",
                        backup.display()
                    ));
                }
            }
            Ok(warning)
        }
        Err(error) => {
            if replace {
                if let Err(restore) = rename_new(&backup, target) {
                    return Err(format!(
                        "{error}. Original destination retained at {}: {restore}",
                        backup.display()
                    ));
                }
            }
            Err(error.to_string())
        }
    }
}

#[tauri::command(async)]
pub async fn project_move_entry(
    workspace_root: String,
    source_path: String,
    dest_dir_path: String,
    resolution: String,
) -> Result<MoveResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = MOVE_LOCK.lock().map_err(|e| e.to_string())?;
        let root = fs::canonicalize(absolute(&workspace_root)?).map_err(|e| e.to_string())?;
        let source = absolute(&source_path)?;
        let parent = fs::canonicalize(source.parent().ok_or("Source has no parent")?)
            .map_err(|e| e.to_string())?;
        if !parent.starts_with(&root) || source == root {
            return Err("Source must be an item inside the workspace.".into());
        }
        let source = parent.join(source.file_name().ok_or("Source has no name")?);
        let destination = fs::canonicalize(absolute(&dest_dir_path)?).map_err(|e| e.to_string())?;
        if !destination.is_dir() {
            return Err("Choose a destination folder.".into());
        }
        let source_meta = fs::symlink_metadata(&source).map_err(|e| e.to_string())?;
        if source_meta.is_dir() && destination.starts_with(&source) {
            return Err("Cannot move a folder into itself or its subfolder.".into());
        }
        if parent == destination {
            return Err("Item is already in this folder.".into());
        }
        let mut target = destination.join(source.file_name().unwrap());
        let conflict = present(&target);
        let can_replace = conflict
            && !source_meta.is_dir()
            && !fs::symlink_metadata(&target)
                .map_err(|e| e.to_string())?
                .is_dir();
        if conflict {
            match resolution.as_str() {
                "skip" => {
                    return Ok(MoveResult {
                        status: "skipped",
                        path: target.to_string_lossy().into_owned(),
                        can_replace,
                        warning: None,
                    })
                }
                "keep-both" => {
                    let stem = source.file_stem().unwrap().to_string_lossy();
                    let extension = if source_meta.is_dir() {
                        None
                    } else {
                        source.extension()
                    };
                    for number in 2.. {
                        let name = if let Some(ext) = extension {
                            format!("{stem} ({number}).{}", ext.to_string_lossy())
                        } else {
                            format!(
                                "{} ({number})",
                                source.file_name().unwrap().to_string_lossy()
                            )
                        };
                        target = destination.join(name);
                        if !present(&target) {
                            break;
                        }
                    }
                }
                "replace" if can_replace => {}
                _ => {
                    return Ok(MoveResult {
                        status: "conflict",
                        path: target.to_string_lossy().into_owned(),
                        can_replace,
                        warning: None,
                    })
                }
            }
        }
        let warning = move_entry(&source, &target, conflict && resolution == "replace", false)?;
        Ok(MoveResult {
            status: "moved",
            path: target.to_string_lossy().into_owned(),
            can_replace,
            warning,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn directory() -> PathBuf {
        let path = sibling(&std::env::temp_dir().join("test"), "move-test");
        fs::create_dir(&path).unwrap();
        path
    }
    #[test]
    fn rename_never_overwrites() {
        let dir = directory();
        let a = dir.join("a");
        let b = dir.join("b");
        fs::write(&a, "source").unwrap();
        fs::write(&b, "destination").unwrap();
        assert!(move_entry(&a, &b, false, false).is_err());
        assert_eq!(fs::read_to_string(&b).unwrap(), "destination");
        assert!(a.exists());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn verified_cross_volume_folder_copy_preserves_hidden_files_and_links() {
        let dir = directory();
        let a = dir.join("a");
        let b = dir.join("b");
        fs::create_dir(&a).unwrap();
        fs::write(a.join(".hidden"), "content").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(".hidden", a.join("link")).unwrap();
        assert!(move_entry(&a, &b, false, true).unwrap().is_none());
        assert!(!a.exists());
        assert_eq!(fs::read_to_string(b.join(".hidden")).unwrap(), "content");
        #[cfg(unix)]
        assert_eq!(
            fs::read_link(b.join("link")).unwrap(),
            PathBuf::from(".hidden")
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn replacement_failure_restores_destination() {
        let dir = directory();
        let a = dir.join("missing");
        let b = dir.join("b");
        fs::write(&b, "original").unwrap();
        assert!(move_entry(&a, &b, true, true).is_err());
        assert_eq!(fs::read_to_string(&b).unwrap(), "original");
        fs::remove_dir_all(dir).unwrap();
    }
}
