//! Installed native assets are resolved independently of runtime process ownership.
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn installed_candidates(resources: Option<&Path>, executable: Option<&Path>) -> Vec<PathBuf> {
    let name = if cfg!(windows) {
        "opencode.exe"
    } else {
        "opencode"
    };
    let mut paths = Vec::new();
    if let Some(dir) = resources {
        paths.push(dir.join(name));
        paths.push(dir.join("binaries").join(name));
    }
    if let Some(dir) = executable.and_then(Path::parent) {
        paths.push(dir.join(name));
    }
    paths
}

pub(crate) fn resolve_opencode_binary(app: &AppHandle) -> Result<PathBuf, String> {
    let resources = app.path().resource_dir().ok();
    let executable = std::env::current_exe().ok();
    if let Some(path) = installed_candidates(resources.as_deref(), executable.as_deref())
        .into_iter()
        .find(|path| path.is_file())
    {
        return Ok(path);
    }
    #[cfg(debug_assertions)]
    {
        let target = match (std::env::consts::ARCH, std::env::consts::OS) {
            ("aarch64", "macos") => Some("aarch64-apple-darwin"),
            ("x86_64", "macos") => Some("x86_64-apple-darwin"),
            ("x86_64", "linux") => Some("x86_64-unknown-linux-gnu"),
            ("aarch64", "linux") => Some("aarch64-unknown-linux-gnu"),
            ("x86_64", "windows") => Some("x86_64-pc-windows-msvc"),
            _ => None,
        };
        if let Some(target) = target {
            let suffix = if cfg!(windows) { ".exe" } else { "" };
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join(format!("opencode-{target}{suffix}"));
            if path.is_file() {
                return Ok(path);
            }
        }
    }
    Err("Bundled native runtime is missing. Reinstall SpecOps or explicitly configure an absolute SPECOPS_OPENCODE_EXECUTABLE path.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installed_candidates_never_search_checkout_or_path() {
        let paths = installed_candidates(
            Some(Path::new("/installed/resources")),
            Some(Path::new("/installed/bin/specops")),
        );
        assert_eq!(paths.len(), 3);
        assert!(paths.iter().all(|path| path.starts_with("/installed")));
        let expected = if cfg!(windows) {
            "opencode.exe"
        } else {
            "opencode"
        };
        assert!(paths
            .iter()
            .all(|path| path.file_name().unwrap() == expected));
        assert!(installed_candidates(None, None).is_empty());
    }
}
