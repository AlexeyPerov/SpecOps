//! Node-independent, finite installer. Only authenticated catalog identities reach disk/network.
use crate::component_catalog::{
    sha256, Availability, CatalogWatermark, VerificationPurpose, VerifiedCatalog,
};
use crate::components::*;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Emitter;

const MAX_JOBS: usize = 32;
const MAX_PLANS: usize = 16;
const RESERVE_BYTES: u64 = 256 * 1024 * 1024;
const ACTIVE_BUDGET: u64 = 4 * 1024 * 1024 * 1024;
const CACHE_BUDGET: u64 = 1024 * 1024 * 1024;
const RETAINED_PER_COMPONENT: usize = 1;
const PLAN_LIFETIME: u64 = 300;
const HOST_VERSION: &str = "0.1.0";
static GENERATION: AtomicU64 = AtomicU64::new(1);
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InstallError {
    Unavailable,
    Unsupported,
    Catalog,
    Storage,
    LowDisk,
    Busy,
    Stale,
    Foreign,
    Confirmation,
    Limit,
    Network,
    Timeout,
    Http,
    Redirect,
    Integrity,
    UnsafeArchive,
    Target,
    Probe,
    Cancelled,
    InUse,
    Shutdown,
}
type Result<T> = std::result::Result<T, InstallError>;
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn io<T>(r: std::io::Result<T>) -> Result<T> {
    r.map_err(|_| InstallError::Storage)
}
fn check(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Acquire) {
        Err(InstallError::Cancelled)
    } else {
        Ok(())
    }
}
fn target() -> Target {
    Target {
        os: "darwin".into(),
        arch: "arm64".into(),
    }
}
fn supported() -> bool {
    cfg!(all(target_os = "macos", target_arch = "aarch64"))
}
fn adapters() -> BTreeMap<ComponentId, String> {
    [
        ComponentId::Node,
        ComponentId::Codex,
        ComponentId::Opencode,
        ComponentId::Claude,
        ComponentId::Cursor,
    ]
    .into_iter()
    .map(|id| (id, format!("as09-{}-1", id.as_str())))
    .collect()
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Request {
    pub id: ComponentId,
    pub version: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub plan_id: String,
    pub digest: String,
    pub catalog_revision: u64,
    pub expires_at: u64,
    pub components: Vec<Request>,
    pub download_bytes: u64,
    pub required_disk_bytes: u64,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Confirmation {
    pub plan_id: String,
    pub digest: String,
    pub confirmed: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobState {
    Downloading,
    Verifying,
    Activating,
    Installed,
    Failed,
    Cancelled,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct JobStatus {
    pub operation_id: String,
    pub generation: u64,
    pub sequence: u64,
    pub state: JobState,
    pub id: Option<ComponentId>,
    pub completed_bytes: u64,
    pub total_bytes: u64,
    pub error: Option<InstallError>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryRow {
    pub id: ComponentId,
    pub version: String,
    pub state: ComponentState,
    pub active: bool,
    pub verified: bool,
    pub target: Target,
    pub availability_reason: String,
    pub download_bytes: Option<u64>,
    pub installed_bytes: Option<u64>,
    pub dependencies: Vec<Request>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskAccounting {
    pub active_bytes: u64,
    pub retained_bytes: u64,
    pub shared_bytes: u64,
    pub staging_bytes: u64,
    pub cache_bytes: u64,
    pub active_budget_bytes: u64,
    pub cache_budget_bytes: u64,
    pub retained_per_component: usize,
    pub unrecognized_bytes: u64,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub catalog_revision: u64,
    pub target: Target,
    pub components: Vec<InventoryRow>,
    pub jobs: Vec<JobStatus>,
    pub disk: DiskAccounting,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RemovalPlan {
    pub components: Vec<Request>,
    pub catalog_revision: u64,
    pub digest: String,
}
struct PendingPlan {
    public: Plan,
    owner: String,
    manifests: Vec<ComponentManifest>,
    attempts: u8,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DurableJob {
    owner: String,
    digest: String,
    status: JobStatus,
}
struct Job {
    owner: String,
    digest: String,
    status: JobStatus,
    cancel: Arc<AtomicBool>,
}
struct Inner {
    roots: ComponentRoots,
    plans: Mutex<BTreeMap<String, PendingPlan>>,
    jobs: Mutex<BTreeMap<String, Job>>,
    threads: Mutex<Vec<thread::JoinHandle<()>>>,
    shutdown: AtomicBool,
    generation: u64,
    #[cfg(test)]
    fixture_catalog: AtomicBool,
    #[cfg(test)]
    available_space: AtomicU64,
    #[cfg(test)]
    fault_boundary: AtomicU64,
}
#[derive(Clone)]
pub struct ComponentManager {
    inner: Arc<Inner>,
}
/// OS-owned advisory lock: process death releases ownership; persistent lock inode is never deleted.
struct MutationLock {
    _file: File,
}
impl MutationLock {
    fn acquire(roots: &ComponentRoots) -> Result<Self> {
        private_dir(&roots.software)?;
        let path = roots.software.join("mutation.lock");
        regular_or_missing(&path)?;
        let file = secure_open(&path, SecureMode::Lock)?;
        file.try_lock_exclusive().map_err(|_| InstallError::Busy)?;
        Ok(Self { _file: file })
    }
}
fn safe_ancestors(path: &Path) -> Result<()> {
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => {}
            Ok(_) => return Err(InstallError::Storage),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(InstallError::Storage),
        }
    }
    Ok(())
}
#[cfg(unix)]
fn directory_fd(path: &Path, create: bool) -> Result<File> {
    use nix::libc;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        io(std::env::current_dir())?.join(path)
    };
    let mut dir = io(File::open("/"))?;
    for part in absolute.components().skip(1) {
        let std::path::Component::Normal(name) = part else {
            return Err(InstallError::Storage);
        };
        let name = std::ffi::CString::new(name.as_bytes()).map_err(|_| InstallError::Storage)?;
        let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
        let mut fd = unsafe { libc::openat(dir.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0
            && create
            && std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound
        {
            if unsafe { libc::mkdirat(dir.as_raw_fd(), name.as_ptr(), 0o700) } < 0
                && std::io::Error::last_os_error().kind() != std::io::ErrorKind::AlreadyExists
            {
                return Err(InstallError::Storage);
            }
            fd = unsafe { libc::openat(dir.as_raw_fd(), name.as_ptr(), flags) };
        }
        if fd < 0 {
            return Err(InstallError::Storage);
        }
        dir = unsafe { File::from_raw_fd(fd) };
    }
    Ok(dir)
}
fn private_dir(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let directory = directory_fd(path, true)?;
        let meta = io(directory.metadata())?;
        if meta.mode() & 0o077 != 0 || meta.uid() != unsafe { nix::libc::geteuid() } {
            return Err(InstallError::Storage);
        }
    }
    #[cfg(not(unix))]
    {
        safe_ancestors(path)?;
        io(fs::create_dir_all(path))?;
    }
    Ok(())
}
#[cfg(unix)]
fn leaf_name(path: &Path) -> Result<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;
    std::ffi::CString::new(path.file_name().ok_or(InstallError::Storage)?.as_bytes())
        .map_err(|_| InstallError::Storage)
}
fn secure_rename(from: &Path, to: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        let source = directory_fd(from.parent().ok_or(InstallError::Storage)?, false)?;
        let destination = directory_fd(to.parent().ok_or(InstallError::Storage)?, false)?;
        let from = leaf_name(from)?;
        let to = leaf_name(to)?;
        if unsafe {
            nix::libc::renameat(
                source.as_raw_fd(),
                from.as_ptr(),
                destination.as_raw_fd(),
                to.as_ptr(),
            )
        } < 0
        {
            return Err(InstallError::Storage);
        }
        io(destination.sync_all())?;
    }
    #[cfg(not(unix))]
    {
        safe_ancestors(from)?;
        safe_ancestors(to)?;
        io(fs::rename(from, to))?;
    }
    Ok(())
}
fn secure_unlink(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        let parent = directory_fd(path.parent().ok_or(InstallError::Storage)?, false)?;
        let name = leaf_name(path)?;
        if unsafe { nix::libc::unlinkat(parent.as_raw_fd(), name.as_ptr(), 0) } < 0 {
            return Err(InstallError::Storage);
        }
        io(parent.sync_all())?;
    }
    #[cfg(not(unix))]
    {
        safe_ancestors(path)?;
        io(fs::remove_file(path))?;
    }
    Ok(())
}
#[cfg(unix)]
fn directory_names(dir: &File) -> Result<Vec<std::ffi::CString>> {
    use nix::libc;
    use std::os::fd::AsRawFd;
    let duplicate = unsafe { libc::dup(dir.as_raw_fd()) };
    if duplicate < 0 {
        return Err(InstallError::Storage);
    }
    let stream = unsafe { libc::fdopendir(duplicate) };
    if stream.is_null() {
        unsafe {
            libc::close(duplicate);
        }
        return Err(InstallError::Storage);
    }
    let mut names = Vec::new();
    loop {
        let entry = unsafe { libc::readdir(stream) };
        if entry.is_null() {
            break;
        }
        let name = unsafe { std::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) };
        if name.to_bytes() == b"." || name.to_bytes() == b".." {
            continue;
        }
        names.push(name.to_owned());
        if names.len() > MAX_FILES {
            unsafe {
                libc::closedir(stream);
            }
            return Err(InstallError::Limit);
        }
    }
    unsafe {
        libc::closedir(stream);
    }
    Ok(names)
}
fn secure_remove_tree(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use nix::libc;
        use std::os::fd::{AsRawFd, FromRawFd};
        fn remove(
            parent: &File,
            name: &std::ffi::CStr,
            count: &mut usize,
            depth: usize,
        ) -> Result<()> {
            *count += 1;
            if *count > MAX_FILES * 6 || depth > 128 {
                return Err(InstallError::Limit);
            }
            let mut stat: libc::stat = unsafe { std::mem::zeroed() };
            if unsafe {
                libc::fstatat(
                    parent.as_raw_fd(),
                    name.as_ptr(),
                    &mut stat,
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            } < 0
            {
                return Err(InstallError::Storage);
            }
            let kind = stat.st_mode & libc::S_IFMT;
            if kind == libc::S_IFDIR {
                let fd = unsafe {
                    libc::openat(
                        parent.as_raw_fd(),
                        name.as_ptr(),
                        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                    )
                };
                if fd < 0 {
                    return Err(InstallError::Storage);
                }
                let directory = unsafe { File::from_raw_fd(fd) };
                use std::os::unix::fs::MetadataExt;
                let meta = io(directory.metadata())?;
                if meta.ino() != stat.st_ino || meta.dev() != stat.st_dev as u64 {
                    return Err(InstallError::Storage);
                }
                for child in directory_names(&directory)? {
                    remove(&directory, &child, count, depth + 1)?;
                }
                if unsafe { libc::unlinkat(parent.as_raw_fd(), name.as_ptr(), libc::AT_REMOVEDIR) }
                    < 0
                {
                    return Err(InstallError::Storage);
                }
            } else if kind == libc::S_IFREG {
                if unsafe { libc::unlinkat(parent.as_raw_fd(), name.as_ptr(), 0) } < 0 {
                    return Err(InstallError::Storage);
                }
            } else {
                return Err(InstallError::Storage);
            }
            Ok(())
        }
        let parent = directory_fd(path.parent().ok_or(InstallError::Storage)?, false)?;
        remove(&parent, &leaf_name(path)?, &mut 0, 0)?;
        io(parent.sync_all())?;
    }
    #[cfg(not(unix))]
    {
        disk_bytes(path)?;
        io(fs::remove_dir_all(path))?;
    }
    Ok(())
}
fn regular_or_missing(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_file() && !m.file_type().is_symlink() => Ok(()),
        Ok(_) => Err(InstallError::Storage),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(InstallError::Storage),
    }
}
#[derive(Clone, Copy)]
enum SecureMode {
    Read,
    Archive,
    Lock,
    Write,
    New,
}
/// Resolve every path segment relative to a held directory fd. No ancestor or leaf
/// symlink is followed, including a substitution between metadata and open.
#[cfg(unix)]
fn secure_open(path: &Path, mode: SecureMode) -> Result<File> {
    use nix::libc;
    use std::os::fd::{AsRawFd, FromRawFd};
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        io(std::env::current_dir())?.join(path)
    };
    let parent = directory_fd(absolute.parent().ok_or(InstallError::Storage)?, false)?;
    use std::os::unix::ffi::OsStrExt;
    let leaf = std::ffi::CString::new(
        absolute
            .file_name()
            .ok_or(InstallError::Storage)?
            .as_bytes(),
    )
    .map_err(|_| InstallError::Storage)?;
    let flags = match mode {
        SecureMode::Read | SecureMode::Archive => libc::O_RDONLY,
        SecureMode::Lock => libc::O_RDWR | libc::O_CREAT,
        SecureMode::Write => libc::O_WRONLY | libc::O_CREAT,
        SecureMode::New => libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL,
    };
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            leaf.as_ptr(),
            flags | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if fd < 0 {
        return Err(InstallError::Storage);
    }
    let file = unsafe { File::from_raw_fd(fd) };
    let meta = io(file.metadata())?;
    use std::os::unix::fs::MetadataExt;
    if !meta.is_file()
        || meta.nlink() != 1
        || meta.uid() != unsafe { libc::geteuid() }
        || (!matches!(mode, SecureMode::Archive) && meta.mode() & 0o077 != 0)
    {
        return Err(InstallError::Storage);
    }
    if matches!(mode, SecureMode::Write) {
        io(file.set_len(0))?;
    }
    Ok(file)
}
#[cfg(not(unix))]
fn secure_open(path: &Path, mode: SecureMode) -> Result<File> {
    safe_ancestors(path.parent().ok_or(InstallError::Storage)?)?;
    regular_or_missing(path)?;
    let mut options = fs::OpenOptions::new();
    match mode {
        SecureMode::Read | SecureMode::Archive => {
            options.read(true);
        }
        SecureMode::Lock => {
            options.read(true).write(true).create(true);
        }
        SecureMode::Write => {
            options.write(true).create(true).truncate(true);
        }
        SecureMode::New => {
            options.write(true).create_new(true);
        }
    }
    io(options.open(path))
}
fn bounded_read(path: &Path, limit: u64) -> Result<Vec<u8>> {
    safe_ancestors(path.parent().ok_or(InstallError::Storage)?)?;
    regular_or_missing(path)?;
    let file = secure_open(path, SecureMode::Read)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if io(file.metadata())?.mode() & 0o077 != 0 {
            return Err(InstallError::Storage);
        }
    }
    if io(file.metadata())?.len() > limit {
        return Err(InstallError::Limit);
    }
    let mut bytes = Vec::new();
    io(file.take(limit + 1).read_to_end(&mut bytes))?;
    if bytes.len() as u64 > limit {
        return Err(InstallError::Limit);
    }
    Ok(bytes)
}
fn sync_dir(path: &Path) -> Result<()> {
    #[cfg(unix)]
    let directory = directory_fd(path, false)?;
    #[cfg(not(unix))]
    let directory = io(File::open(path))?;
    io(directory.sync_all())
}
fn atomic_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let parent = path.parent().ok_or(InstallError::Storage)?;
    private_dir(parent)?;
    regular_or_missing(path)?;
    let temporary = path.with_extension("pending");
    regular_or_missing(&temporary)?;
    let mut f = secure_open(&temporary, SecureMode::Write)?;
    io(f.write_all(&serde_json::to_vec(value).map_err(|_| InstallError::Storage)?))?;
    io(f.sync_all())?;
    secure_rename(&temporary, path)?;
    sync_dir(parent)
}
/// A runtime must hold this lease until its process tree has exited. Acquisition rehashes all files.
/// Native paths are crate-internal; they never appear in component diagnostics or frontend events.
pub struct RuntimeLease {
    pub root: PathBuf,
    pub manifest: ComponentManifest,
    _lock: File,
    #[cfg(unix)]
    _directory: File,
}
impl ComponentManager {
    fn lease_file(&self, id: ComponentId, version: &str) -> Result<File> {
        self.inner
            .roots
            .version(id, version)
            .map_err(|_| InstallError::Storage)?;
        let dir = self.inner.roots.software.join("leases").join(id.as_str());
        private_dir(&dir)?;
        let path = dir.join(format!("{}.lock", version));
        regular_or_missing(&path)?;
        secure_open(&path, SecureMode::Lock)
    }
    fn exclusive_version(&self, id: ComponentId, version: &str) -> Result<File> {
        let file = self.lease_file(id, version)?;
        FileExt::try_lock_exclusive(&file).map_err(|_| InstallError::InUse)?;
        Ok(file)
    }
    pub fn acquire_runtime(&self, id: ComponentId) -> Result<RuntimeLease> {
        let _mutation = MutationLock::acquire(&self.inner.roots)?;
        let catalog = self.catalog(VerificationPurpose::InstalledReceipt)?;
        let version = self.active_version(id)?.ok_or(InstallError::Unavailable)?;
        let manifest = catalog
            .installed_manifest(id, &version, &target())
            .map_err(|_| InstallError::Unavailable)?
            .clone();
        let root = self.ready(&catalog, &manifest)?;
        for dep in &manifest.dependencies {
            if self.active_version(dep.id)?.as_deref() != Some(dep.version.as_str()) {
                return Err(InstallError::InUse);
            }
        }
        let file = self.lease_file(id, &version)?;
        FileExt::try_lock_shared(&file).map_err(|_| InstallError::InUse)?;
        Ok(RuntimeLease {
            root: root.clone(),
            manifest,
            _lock: file,
            #[cfg(unix)]
            _directory: directory_fd(&root, false)?,
        })
    }
    fn activation_guard(&self, id: ComponentId, next: &str) -> Result<Option<File>> {
        if let Some(current) = self.active_version(id)? {
            if current != next {
                return self.exclusive_version(id, &current).map(Some);
            }
        }
        Ok(None)
    }
}
impl ComponentManager {
    fn checkpoint(&self, boundary: u64) -> Result<()> {
        #[cfg(test)]
        if self.inner.fault_boundary.load(Ordering::Relaxed) == boundary {
            return Err(InstallError::Shutdown);
        }
        let _ = boundary;
        Ok(())
    }
    pub fn new(app_data: &Path) -> Self {
        Self {
            inner: Arc::new(Inner {
                roots: ComponentRoots::new(app_data),
                plans: Mutex::new(BTreeMap::new()),
                jobs: Mutex::new(BTreeMap::new()),
                threads: Mutex::new(Vec::new()),
                shutdown: AtomicBool::new(false),
                generation: now().saturating_mul(1000) + GENERATION.fetch_add(1, Ordering::Relaxed),
                #[cfg(test)]
                fixture_catalog: AtomicBool::new(false),
                #[cfg(test)]
                available_space: AtomicU64::new(u64::MAX),
                #[cfg(test)]
                fault_boundary: AtomicU64::new(0),
            }),
        }
    }
    fn catalog(&self, purpose: VerificationPurpose) -> Result<VerifiedCatalog> {
        if self.inner.roots.software.exists() {
            private_dir(&self.inner.roots.software)?;
        }
        let path = self.inner.roots.software.join("catalog-watermark.json");
        let highest: Option<CatalogWatermark> = if path.exists() {
            Some(
                serde_json::from_slice(&bounded_read(&path, 4096)?)
                    .map_err(|_| InstallError::Catalog)?,
            )
        } else {
            None
        };
        let cache = self.inner.roots.software.join("catalog-envelope.json");
        if cache.try_exists().map_err(|_| InstallError::Storage)? {
            return VerifiedCatalog::verify(
                &bounded_read(
                    &cache,
                    (crate::component_catalog::MAX_CATALOG_BYTES * 2 + 1024) as u64,
                )?,
                &self.trust_policy()?,
                now(),
                purpose,
                highest.as_ref(),
            )
            .map_err(|_| InstallError::Catalog);
        }
        #[cfg(test)]
        if self.inner.fixture_catalog.load(Ordering::Relaxed) {
            return VerifiedCatalog::verify(
                include_bytes!("../fixtures/components/distribution/catalog.json"),
                &crate::component_catalog::TrustPolicy::fixture(),
                now(),
                purpose,
                highest.as_ref(),
            )
            .map_err(|_| InstallError::Catalog);
        }
        // Constructor verifies with embedded public trust; there is no UI URL/key override.
        VerifiedCatalog::embedded(now(), purpose, highest.as_ref())
            .map_err(|_| InstallError::Catalog)
    }
    fn trust_policy(&self) -> Result<crate::component_catalog::TrustPolicy> {
        #[cfg(test)]
        if self.inner.fixture_catalog.load(Ordering::Relaxed) {
            return Ok(crate::component_catalog::TrustPolicy::fixture());
        }
        crate::component_catalog::TrustPolicy::embedded().map_err(|_| InstallError::Catalog)
    }
    pub(crate) fn accept_catalog(&self, bytes: &[u8]) -> Result<u64> {
        let _lock = MutationLock::acquire(&self.inner.roots)?;
        let previous = self.catalog(VerificationPurpose::InstalledReceipt)?;
        let next = VerifiedCatalog::verify(
            bytes,
            &self.trust_policy()?,
            now(),
            VerificationPurpose::NewInstall,
            Some(previous.watermark()),
        )
        .map_err(|_| InstallError::Catalog)?;
        for revoked in previous.revocations() {
            if !next.revoked(revoked.id, &revoked.version, &revoked.target) {
                return Err(InstallError::Catalog);
            }
        }
        for old in previous
            .rows()
            .iter()
            .filter_map(|row| row.manifest.as_ref())
        {
            if let Some(current) = next
                .rows()
                .iter()
                .filter_map(|row| row.manifest.as_ref())
                .find(|m| m.id == old.id && m.version == old.version && m.target == old.target)
            {
                if VerifiedCatalog::manifest_identity(old).map_err(|_| InstallError::Catalog)?
                    != VerifiedCatalog::manifest_identity(current)
                        .map_err(|_| InstallError::Catalog)?
                {
                    return Err(InstallError::Catalog);
                }
            } else {
                let path = self
                    .inner
                    .roots
                    .version(old.id, &old.version)
                    .map_err(|_| InstallError::Storage)?;
                if path.try_exists().map_err(|_| InstallError::Storage)?
                    || self.active_version(old.id)?.as_deref() == Some(old.version.as_str())
                {
                    return Err(InstallError::Catalog);
                }
            }
        }
        // Signed envelope first, then monotonic watermark. Interrupted commits fail closed
        // and never accept an older envelope over an existing high watermark.
        let value: serde_json::Value =
            serde_json::from_slice(bytes).map_err(|_| InstallError::Catalog)?;
        atomic_json(
            &self.inner.roots.software.join("catalog-envelope.json"),
            &value,
        )?;
        self.persist_catalog(&next)?;
        Ok(next.watermark().revision)
    }
    pub async fn refresh_catalog(&self) -> Result<u64> {
        let policy = self.trust_policy()?;
        let endpoint = policy.catalog_endpoint().ok_or(InstallError::Unavailable)?;
        let bytes = fetch_catalog(endpoint).await?;
        self.accept_catalog(&bytes)
    }
    /// Revalidate the exact leased identity at each executable request boundary. Cleanup
    /// of existing activity remains possible; new work never trusts a cached host binding.
    pub fn validate_launch(&self, lease: &RuntimeLease) -> Result<()> {
        let catalog = self.catalog(VerificationPurpose::InstalledReceipt)?;
        let m = catalog
            .installed_manifest(lease.manifest.id, &lease.manifest.version, &target())
            .map_err(|_| InstallError::Unavailable)?;
        if VerifiedCatalog::manifest_identity(m).map_err(|_| InstallError::Catalog)?
            != VerifiedCatalog::manifest_identity(&lease.manifest)
                .map_err(|_| InstallError::Catalog)?
        {
            return Err(InstallError::Integrity);
        }
        if self.ready(&catalog, m)? != lease.root {
            return Err(InstallError::Integrity);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let held = io(lease._directory.metadata())?;
            let current = io(directory_fd(&lease.root, false)?.metadata())?;
            if current.dev() != held.dev() || current.ino() != held.ino() {
                return Err(InstallError::Integrity);
            }
        }
        for dep in &m.dependencies {
            let manifest = catalog
                .installed_manifest(dep.id, &dep.version, &target())
                .map_err(|_| InstallError::Unavailable)?;
            self.ready(&catalog, manifest)?;
        }
        Ok(())
    }
    fn activation_budget(&self, next: &ComponentManifest) -> Result<()> {
        let mut allocated = 0u64;
        for id in [
            ComponentId::Node,
            ComponentId::Codex,
            ComponentId::Opencode,
            ComponentId::Claude,
            ComponentId::Cursor,
        ] {
            let version = if id == next.id {
                Some(next.version.clone())
            } else {
                self.active_version(id)?
            };
            if let Some(version) = version {
                allocated = allocated
                    .checked_add(disk_bytes(
                        &self
                            .inner
                            .roots
                            .version(id, &version)
                            .map_err(|_| InstallError::Storage)?,
                    )?)
                    .ok_or(InstallError::Limit)?;
            }
        }
        if allocated > ACTIVE_BUDGET {
            return Err(InstallError::Limit);
        }
        Ok(())
    }
    fn store_transition(&self, catalog: &VerifiedCatalog, next: &ComponentManifest) -> Result<()> {
        let Some(current) = self.active_version(next.id)? else {
            return Ok(());
        };
        if current == next.version || next.id == ComponentId::Node {
            return Ok(());
        }
        let old = catalog
            .rows()
            .iter()
            .find(|row| row.id == next.id && row.version == current && row.target == target())
            .and_then(|row| row.manifest.as_ref())
            .ok_or(InstallError::Catalog)?;
        // Exact authenticated native-store contract only. Missing/unknown or differing
        // contracts require an adapter release and explicit native recovery, never conversion.
        if old.compatibility.native_store_revision != next.compatibility.native_store_revision
            || old.compatibility.native_store_revision == "unknown"
        {
            return Err(InstallError::Catalog);
        }
        Ok(())
    }
    fn persist_catalog(&self, catalog: &VerifiedCatalog) -> Result<()> {
        atomic_json(
            &self.inner.roots.software.join("catalog-watermark.json"),
            catalog.watermark(),
        )
    }
    fn ready(&self, catalog: &VerifiedCatalog, m: &ComponentManifest) -> Result<PathBuf> {
        m.compatible(
            env!("CARGO_PKG_VERSION"),
            HOST_VERSION,
            adapters().get(&m.id).ok_or(InstallError::Catalog)?,
        )
        .map_err(|_| InstallError::Catalog)?;
        let root = self
            .inner
            .roots
            .version(m.id, &m.version)
            .map_err(|_| InstallError::Storage)?;
        let receipt: InstallReceipt =
            serde_json::from_slice(&bounded_read(&root.join("receipt.json"), 4096)?)
                .map_err(|_| InstallError::Integrity)?;
        let digest = VerifiedCatalog::manifest_identity(m).map_err(|_| InstallError::Catalog)?;
        // Receipts bind their installation catalog. Later signed revisions may retain the exact manifest.
        receipt
            .validate(m, &digest, &receipt.catalog_revision)
            .map_err(|_| InstallError::Integrity)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if io(secure_open(&root.join("receipt.json"), SecureMode::Read)?.metadata())?.mode()
                & 0o777
                != 0o400
            {
                return Err(InstallError::Integrity);
            }
        }
        let revision = receipt
            .catalog_revision
            .parse::<u64>()
            .map_err(|_| InstallError::Integrity)?;
        if revision == 0 || revision > catalog.watermark().revision {
            return Err(InstallError::Integrity);
        }
        validate_inventory(&root, m, &AtomicBool::new(false))?;
        Ok(root)
    }
    fn active_version(&self, id: ComponentId) -> Result<Option<String>> {
        let path = self
            .inner
            .roots
            .active()
            .join(format!("{}.json", id.as_str()));
        if !path.exists() {
            return Ok(None);
        }
        let request: Request = serde_json::from_slice(&bounded_read(&path, 512)?)
            .map_err(|_| InstallError::Integrity)?;
        if request.id != id || self.inner.roots.version(id, &request.version).is_err() {
            return Err(InstallError::Integrity);
        }
        Ok(Some(request.version))
    }
    pub fn list(&self) -> Result<Vec<InventoryRow>> {
        let catalog = self.catalog(VerificationPurpose::InstalledReceipt)?;
        if let Ok(_lock) = MutationLock::acquire(&self.inner.roots) {
            self.persist_catalog(&catalog)?;
        }
        Ok(self.inventory(&catalog))
    }
    fn inventory(&self, catalog: &VerifiedCatalog) -> Vec<InventoryRow> {
        catalog
            .rows()
            .iter()
            .map(|r| {
                let verified = catalog
                    .installed_manifest(r.id, &r.version, &r.target)
                    .ok()
                    .and_then(|m| self.ready(catalog, m).ok())
                    .is_some();
                let active =
                    self.active_version(r.id).ok().flatten().as_deref() == Some(r.version.as_str());
                let compatible = r.manifest.as_ref().is_some_and(|m| {
                    let mut plan = Vec::new();
                    for dep in &m.dependencies {
                        let Ok(manifest) =
                            catalog.installed_manifest(dep.id, &dep.version, &target())
                        else {
                            return false;
                        };
                        plan.push(manifest.clone());
                    }
                    plan.push(m.clone());
                    validate_plan(
                        &plan,
                        env!("CARGO_PKG_VERSION"),
                        HOST_VERSION,
                        &adapters(),
                        false,
                    )
                    .is_ok()
                        && self.store_transition(catalog, m).is_ok()
                });
                let update = !active
                    && compatible
                    && self
                        .active_version(r.id)
                        .ok()
                        .flatten()
                        .is_some_and(|v| tested_version_newer(&r.version, &v))
                    && catalog
                        .install_manifest(r.id, &r.version, &r.target)
                        .is_ok();
                let in_use = verified && self.exclusive_version(r.id, &r.version).is_err();
                let state = if !supported() {
                    ComponentState::Unsupported
                } else if r.manifest.is_some()
                    && (!compatible || catalog.revoked(r.id, &r.version, &r.target))
                {
                    ComponentState::Incompatible
                } else if in_use {
                    ComponentState::InUse
                } else if update {
                    ComponentState::UpdateAvailable
                } else if verified {
                    ComponentState::Installed
                } else if r.availability == Availability::Unavailable {
                    ComponentState::Unavailable
                } else {
                    ComponentState::Missing
                };
                InventoryRow {
                    id: r.id,
                    version: r.version.clone(),
                    state,
                    active: active && verified,
                    verified,
                    target: r.target.clone(),
                    availability_reason: r.reason.clone(),
                    download_bytes: r.manifest.as_ref().map(|m| m.archive.compressed_bytes),
                    installed_bytes: r.manifest.as_ref().map(|m| m.archive.unpacked_bytes),
                    dependencies: r
                        .manifest
                        .as_ref()
                        .map(|m| {
                            m.dependencies
                                .iter()
                                .map(|d| Request {
                                    id: d.id,
                                    version: d.version.clone(),
                                })
                                .collect()
                        })
                        .unwrap_or_default(),
                }
            })
            .collect()
    }
    pub fn plan(&self, owner: &str, request: Request) -> Result<Plan> {
        if !supported() {
            return Err(InstallError::Unsupported);
        }
        let _lock = MutationLock::acquire(&self.inner.roots)?;
        let catalog = self.catalog(VerificationPurpose::NewInstall)?;
        self.persist_catalog(&catalog)?;
        self.plan_verified(owner, request, &catalog)
    }
    fn plan_verified(
        &self,
        owner: &str,
        request: Request,
        catalog: &VerifiedCatalog,
    ) -> Result<Plan> {
        if self.inner.shutdown.load(Ordering::Acquire) {
            return Err(InstallError::Shutdown);
        }
        let m = catalog
            .install_manifest(request.id, &request.version, &target())
            .map_err(|_| InstallError::Unavailable)?;
        self.store_transition(catalog, m)?;
        let mut manifests = Vec::new();
        for dep in &m.dependencies {
            manifests.push(
                catalog
                    .install_manifest(dep.id, &dep.version, &target())
                    .map_err(|_| InstallError::Unavailable)?
                    .clone(),
            );
        }
        manifests.push(m.clone());
        validate_plan(
            &manifests,
            env!("CARGO_PKG_VERSION"),
            HOST_VERSION,
            &adapters(),
            false,
        )
        .map_err(|_| InstallError::Catalog)?;
        let components = manifests
            .iter()
            .map(|m| Request {
                id: m.id,
                version: m.version.clone(),
            })
            .collect::<Vec<_>>();
        let missing = manifests
            .iter()
            .filter(|m| self.ready(catalog, m).is_err())
            .collect::<Vec<_>>();
        let mut active_bytes = 0u64;
        for id in [
            ComponentId::Node,
            ComponentId::Codex,
            ComponentId::Opencode,
            ComponentId::Claude,
            ComponentId::Cursor,
        ] {
            if let Some(next) = manifests.iter().find(|m| m.id == id) {
                active_bytes = active_bytes
                    .checked_add(next.archive.unpacked_bytes)
                    .ok_or(InstallError::Limit)?;
            } else if let Some(version) = self.active_version(id)? {
                active_bytes = active_bytes
                    .checked_add(disk_bytes(
                        &self
                            .inner
                            .roots
                            .version(id, &version)
                            .map_err(|_| InstallError::Storage)?,
                    )?)
                    .ok_or(InstallError::Limit)?;
            }
        }
        if active_bytes > ACTIVE_BUDGET {
            return Err(InstallError::Limit);
        }
        let download_bytes = missing.iter().map(|m| m.archive.compressed_bytes).sum();
        let required_disk_bytes = missing
            .iter()
            .try_fold(RESERVE_BYTES, |a, m| {
                a.checked_add(m.archive.compressed_bytes)?
                    .checked_add(m.archive.unpacked_bytes.checked_mul(2)?)
            })
            .ok_or(InstallError::Limit)?;
        let mut plans = self.inner.plans.lock().map_err(|_| InstallError::Storage)?;
        plans.retain(|_, p| p.public.expires_at >= now());
        if plans.len() >= MAX_PLANS {
            return Err(InstallError::Limit);
        }
        let digest = sha256(
            &serde_json::to_vec(&(catalog.watermark(), &manifests))
                .map_err(|_| InstallError::Catalog)?,
        );
        let plan_id = format!(
            "p-{}-{}",
            self.inner.generation,
            GENERATION.fetch_add(1, Ordering::Relaxed)
        );
        let public = Plan {
            plan_id: plan_id.clone(),
            digest,
            catalog_revision: catalog.watermark().revision,
            expires_at: now() + PLAN_LIFETIME,
            components,
            download_bytes,
            required_disk_bytes,
        };
        plans.insert(
            plan_id,
            PendingPlan {
                public: public.clone(),
                owner: owner.into(),
                manifests,
                attempts: 0,
            },
        );
        Ok(public)
    }
    pub fn install(
        &self,
        owner: &str,
        confirmation: Confirmation,
        app: Option<tauri::AppHandle>,
    ) -> Result<JobStatus> {
        if confirmation.confirmed {
            let jobs = self.inner.jobs.lock().map_err(|_| InstallError::Storage)?;
            if let Some(job) = jobs
                .values()
                .find(|j| j.digest == confirmation.digest && !terminal(j.status.state))
            {
                return Ok(job.status.clone());
            }
        }
        let lock = match MutationLock::acquire(&self.inner.roots) {
            Ok(lock) => lock,
            Err(InstallError::Busy) => {
                let path = self.inner.roots.software.join("current-job.json");
                let status: DurableJob = serde_json::from_slice(&bounded_read(&path, 8192)?)
                    .map_err(|_| InstallError::Busy)?;
                if confirmation.confirmed
                    && status.digest == confirmation.digest
                    && !terminal(status.status.state)
                {
                    return Ok(status.status);
                }
                return Err(InstallError::Busy);
            }
            Err(error) => return Err(error),
        };
        let catalog = self.catalog(VerificationPurpose::NewInstall)?;
        self.persist_catalog(&catalog)?;
        self.start_verified(owner, confirmation, catalog, lock, app, None)
    }
    fn start_verified(
        &self,
        owner: &str,
        confirmation: Confirmation,
        catalog: VerifiedCatalog,
        lock: MutationLock,
        app: Option<tauri::AppHandle>,
        fixture_endpoint: Option<String>,
    ) -> Result<JobStatus> {
        if self.inner.shutdown.load(Ordering::Acquire) {
            return Err(InstallError::Shutdown);
        }
        if !confirmation.confirmed {
            return Err(InstallError::Confirmation);
        }
        let mut plans = self.inner.plans.lock().map_err(|_| InstallError::Storage)?;
        let pending = plans
            .get_mut(&confirmation.plan_id)
            .ok_or(InstallError::Stale)?;
        if pending.owner != owner {
            return Err(InstallError::Foreign);
        }
        if pending.public.digest != confirmation.digest
            || pending.public.expires_at < now()
            || pending.public.catalog_revision != catalog.watermark().revision
        {
            return Err(InstallError::Stale);
        }
        for m in &pending.manifests {
            let current = catalog
                .install_manifest(m.id, &m.version, &m.target)
                .map_err(|_| InstallError::Unavailable)?;
            if VerifiedCatalog::manifest_identity(m).ok()
                != VerifiedCatalog::manifest_identity(current).ok()
            {
                return Err(InstallError::Stale);
            }
        }
        // A prerequisite removed/altered after review requires a fresh reviewed plan.
        let current_download_bytes: u64 = pending
            .manifests
            .iter()
            .filter(|m| self.ready(&catalog, m).is_err())
            .map(|m| m.archive.compressed_bytes)
            .sum();
        if current_download_bytes > pending.public.download_bytes {
            return Err(InstallError::Stale);
        }
        let available =
            fs2::available_space(&self.inner.roots.software).map_err(|_| InstallError::Storage)?;
        #[cfg(test)]
        let available = available.min(self.inner.available_space.load(Ordering::Relaxed));
        if available < pending.public.required_disk_bytes {
            return Err(InstallError::LowDisk);
        }
        if pending.attempts >= 4 {
            return Err(InstallError::Limit);
        }
        let manifests = pending.manifests.clone();
        let mut jobs = self.inner.jobs.lock().map_err(|_| InstallError::Storage)?;
        if let Some(j) = jobs
            .values()
            .find(|j| j.digest == confirmation.digest && !terminal(j.status.state))
        {
            return Ok(j.status.clone());
        }
        if jobs.values().any(|j| !terminal(j.status.state)) {
            return Err(InstallError::Busy);
        }
        if jobs.len() >= MAX_JOBS {
            let oldest = jobs
                .iter()
                .filter(|(_, j)| terminal(j.status.state))
                .min_by_key(|(_, j)| j.status.sequence)
                .map(|(k, _)| k.clone());
            if let Some(k) = oldest {
                jobs.remove(&k);
            }
        }
        let operation_id = format!(
            "j-{}-{}",
            self.inner.generation,
            GENERATION.fetch_add(1, Ordering::Relaxed)
        );
        let status = JobStatus {
            operation_id: operation_id.clone(),
            generation: self.inner.generation,
            sequence: 1,
            state: JobState::Downloading,
            id: None,
            completed_bytes: 0,
            total_bytes: pending.public.download_bytes,
            error: None,
        };
        let cancel = Arc::new(AtomicBool::new(false));
        atomic_json(
            &self.inner.roots.software.join("current-job.json"),
            &DurableJob {
                owner: owner.into(),
                digest: confirmation.digest.clone(),
                status: status.clone(),
            },
        )?;
        jobs.insert(
            operation_id.clone(),
            Job {
                owner: owner.into(),
                digest: confirmation.digest,
                status: status.clone(),
                cancel: cancel.clone(),
            },
        );
        pending.attempts += 1;
        drop(jobs);
        drop(plans);
        let manager = self.clone();
        let thread = thread::spawn(move || {
            let _ownership = lock;
            let finished = AtomicBool::new(false);
            let result = thread::scope(|scope| {
                let heartbeat = scope.spawn(|| {
                    while !finished.load(Ordering::Acquire) {
                        thread::sleep(Duration::from_millis(250));
                        if !finished.load(Ordering::Acquire) {
                            manager.pulse(&operation_id, app.as_ref());
                        }
                    }
                });
                let result = manager.run_install(
                    &operation_id,
                    &catalog,
                    &manifests,
                    &cancel,
                    app.as_ref(),
                    fixture_endpoint.as_deref(),
                );
                finished.store(true, Ordering::Release);
                let _ = heartbeat.join();
                result
            });
            manager.emit(
                &operation_id,
                if result == Err(InstallError::Cancelled) {
                    JobState::Cancelled
                } else if result.is_err() {
                    JobState::Failed
                } else {
                    JobState::Installed
                },
                None,
                0,
                0,
                result.err(),
                app.as_ref(),
            );
        });
        let mut threads = self
            .inner
            .threads
            .lock()
            .map_err(|_| InstallError::Storage)?;
        let mut retained = Vec::new();
        for t in threads.drain(..) {
            if t.is_finished() {
                let _ = t.join();
            } else {
                retained.push(t);
            }
        }
        *threads = retained;
        threads.push(thread);
        Ok(status)
    }
    fn pulse(&self, operation: &str, app: Option<&tauri::AppHandle>) {
        if let Ok(mut jobs) = self.inner.jobs.lock() {
            if let Some(job) = jobs.get_mut(operation) {
                if !terminal(job.status.state) {
                    job.status.sequence += 1;
                    if let Some(app) = app {
                        let _ = app.emit("component-status", &job.status);
                    }
                }
            }
        }
    }
    fn emit(
        &self,
        operation: &str,
        state: JobState,
        id: Option<ComponentId>,
        completed: u64,
        total: u64,
        error: Option<InstallError>,
        app: Option<&tauri::AppHandle>,
    ) {
        if let Ok(mut jobs) = self.inner.jobs.lock() {
            if let Some(job) = jobs.get_mut(operation) {
                job.status.sequence += 1;
                job.status.state = state;
                job.status.id = id;
                job.status.completed_bytes = completed;
                job.status.total_bytes = total;
                job.status.error = error;
                let _ = atomic_json(
                    &self.inner.roots.software.join("current-job.json"),
                    &DurableJob {
                        owner: job.owner.clone(),
                        digest: job.digest.clone(),
                        status: job.status.clone(),
                    },
                );
                if let Some(app) = app {
                    let _ = app.emit("component-status", &job.status);
                }
            }
        }
    }
    fn run_install(
        &self,
        operation: &str,
        catalog: &VerifiedCatalog,
        manifests: &[ComponentManifest],
        cancel: &AtomicBool,
        app: Option<&tauri::AppHandle>,
        fixture_endpoint: Option<&str>,
    ) -> Result<()> {
        self.recover_locked()?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| InstallError::Network)?;
        for m in manifests {
            check(cancel)?;
            if self.ready(catalog, m).is_err() {
                let stage = self
                    .inner
                    .roots
                    .staging()
                    .join(operation)
                    .join(m.id.as_str());
                private_dir(&stage)?;
                atomic_json(
                    &stage
                        .parent()
                        .ok_or(InstallError::Storage)?
                        .join("owner.json"),
                    &operation,
                )?;
                let archive = stage.join("archive.part");
                runtime.block_on(download(m, &archive, cancel, fixture_endpoint, |n| {
                    self.emit(
                        operation,
                        JobState::Downloading,
                        Some(m.id),
                        n,
                        m.archive.compressed_bytes,
                        None,
                        app,
                    )
                }))?;
                self.checkpoint(1)?;
                self.emit(
                    operation,
                    JobState::Verifying,
                    Some(m.id),
                    0,
                    m.archive.unpacked_bytes,
                    None,
                    app,
                );
                let content = stage.join("content");
                private_dir(&content)?;
                let synthetic_fixture =
                    cfg!(test) && m.distribution.evidence_id == "local-fixture-only";
                extract(&archive, &content, m, cancel, synthetic_fixture)?;
                validate_inventory(&content, m, cancel)?;
                probe(&content, m, cancel, synthetic_fixture)?;
                self.checkpoint(2)?;
                check(cancel)?;
                let receipt = InstallReceipt {
                    schema_version: 1,
                    id: m.id,
                    version: m.version.clone(),
                    target: m.target.clone(),
                    manifest_sha256: VerifiedCatalog::manifest_identity(m)
                        .map_err(|_| InstallError::Catalog)?,
                    catalog_revision: catalog.watermark().revision.to_string(),
                };
                atomic_json(&content.join("receipt.json"), &receipt)?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    io(
                        secure_open(&content.join("receipt.json"), SecureMode::Read)?
                            .set_permissions(fs::Permissions::from_mode(0o400)),
                    )?;
                }
                sync_tree(&content)?;
                self.checkpoint(3)?;
                let destination = self
                    .inner
                    .roots
                    .version(m.id, &m.version)
                    .map_err(|_| InstallError::Storage)?;
                let parent = destination.parent().ok_or(InstallError::Storage)?;
                private_dir(parent)?;
                // Never overwrite an immutable version. A corrupt previous directory is explicitly removed first.
                if destination.exists() {
                    let _corrupt = self.exclusive_version(m.id, &m.version)?;
                    secure_remove_tree(&destination)?;
                    sync_dir(parent)?;
                }
                self.emit(operation, JobState::Activating, Some(m.id), 0, 0, None, app);
                check(cancel)?;
                secure_rename(&content, &destination)?;
                sync_dir(parent)?;
                self.checkpoint(4)?;
            }
            self.ready(catalog, m)?;
            self.store_transition(catalog, m)?;
            self.activation_budget(m)?;
            // Atomic selection is the commit boundary. Cancellation does not interrupt the rename/fsync pair.
            check(cancel)?;
            let _activation = self.activation_guard(m.id, &m.version)?;
            atomic_json(
                &self
                    .inner
                    .roots
                    .active()
                    .join(format!("{}.json", m.id.as_str())),
                &Request {
                    id: m.id,
                    version: m.version.clone(),
                },
            )?;
            self.checkpoint(5)?;
        }
        self.recover_locked()?;
        self.clean_retained_locked(catalog)?;
        Ok(())
    }
    fn recover_locked(&self) -> Result<()> {
        // The global OS lock excludes every living installer. Only operation-owned
        // staging trees and known signed archive identities may be reclaimed.
        let root = self.inner.roots.staging();
        if root.exists() {
            private_dir(&root)?;
            for entry in io(fs::read_dir(&root))? {
                let p = io(entry)?.path();
                let meta = io(fs::symlink_metadata(&p))?;
                if !meta.is_dir() || meta.file_type().is_symlink() {
                    return Err(InstallError::Storage);
                }
                let marker = p.join("owner.json");
                let owned = bounded_read(&marker, 512)
                    .ok()
                    .and_then(|b| serde_json::from_slice::<String>(&b).ok())
                    .is_some_and(|id| p.file_name().is_some_and(|name| name == id.as_str()));
                if owned {
                    disk_bytes(&p)?;
                    secure_remove_tree(&p)?;
                }
            }
        }
        let root = self.inner.roots.cache();
        if root.exists() {
            private_dir(&root)?;
            let catalog = self.catalog(VerificationPurpose::InstalledReceipt)?;
            for entry in io(fs::read_dir(&root))? {
                let p = io(entry)?.path();
                let name = p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .ok_or(InstallError::Storage)?;
                let owned = catalog
                    .rows()
                    .iter()
                    .filter_map(|r| r.manifest.as_ref())
                    .any(|m| name == format!("{}.tar.gz", m.archive.sha256));
                if owned {
                    regular_or_missing(&p)?;
                    secure_unlink(&p)?;
                }
            }
        }
        Ok(())
    }
    pub fn cancel(&self, owner: &str, operation: &str, generation: u64) -> Result<JobStatus> {
        let mut jobs = self.inner.jobs.lock().map_err(|_| InstallError::Storage)?;
        let job = jobs.get_mut(operation).ok_or(InstallError::Stale)?;
        if generation != self.inner.generation {
            return Err(InstallError::Stale);
        }
        if job.owner != owner {
            return Err(InstallError::Foreign);
        }
        if !terminal(job.status.state) {
            job.cancel.store(true, Ordering::Release);
        }
        Ok(job.status.clone())
    }
    pub fn retry(
        &self,
        owner: &str,
        operation: &str,
        generation: u64,
        confirmation: Confirmation,
        app: Option<tauri::AppHandle>,
    ) -> Result<JobStatus> {
        {
            let jobs = self.inner.jobs.lock().map_err(|_| InstallError::Storage)?;
            let job = jobs.get(operation).ok_or(InstallError::Stale)?;
            if generation != self.inner.generation {
                return Err(InstallError::Stale);
            }
            if job.owner != owner {
                return Err(InstallError::Foreign);
            }
            if !matches!(job.status.state, JobState::Failed | JobState::Cancelled)
                || job.digest != confirmation.digest
            {
                return Err(InstallError::Confirmation);
            }
        }
        self.install(owner, confirmation, app)
    }
    pub fn select(&self, request: Request) -> Result<()> {
        let _lock = MutationLock::acquire(&self.inner.roots)?;
        let catalog = self.catalog(VerificationPurpose::NewInstall)?;
        self.persist_catalog(&catalog)?;
        let m = catalog
            .install_manifest(request.id, &request.version, &target())
            .map_err(|_| InstallError::Unavailable)?;
        self.ready(&catalog, m)?;
        self.store_transition(&catalog, m)?;
        self.activation_budget(m)?;
        for dep in &m.dependencies {
            let d = catalog
                .install_manifest(dep.id, &dep.version, &target())
                .map_err(|_| InstallError::Unavailable)?;
            self.ready(&catalog, d)?;
            if self.active_version(dep.id)?.as_deref() != Some(dep.version.as_str()) {
                return Err(InstallError::InUse);
            }
        }
        let _activation = self.activation_guard(request.id, &request.version)?;
        atomic_json(
            &self
                .inner
                .roots
                .active()
                .join(format!("{}.json", request.id.as_str())),
            &request,
        )
    }
    pub fn remove(&self, request: Request) -> Result<()> {
        let _lock = MutationLock::acquire(&self.inner.roots)?;
        let catalog = self.catalog(VerificationPurpose::InstalledReceipt)?;
        self.remove_locked(&catalog, request)
    }
    fn unknown_software_blocks_shared_removal(&self, catalog: &VerifiedCatalog) -> Result<()> {
        let versions = self.inner.roots.software.join("versions");
        if !versions.exists() {
            return Ok(());
        }
        let mut count = 0;
        for id_entry in io(fs::read_dir(&versions))? {
            count += 1;
            if count > 80 {
                return Err(InstallError::Limit);
            }
            let id_entry = io(id_entry)?;
            let id = id_entry.file_name().to_string_lossy().into_owned();
            if !catalog
                .rows()
                .iter()
                .any(|row| row.id.as_str() == id && row.manifest.is_some())
            {
                return Err(InstallError::InUse);
            }
            if !io(id_entry.file_type())?.is_dir() {
                return Err(InstallError::Storage);
            }
            for version_entry in io(fs::read_dir(id_entry.path()))? {
                count += 1;
                if count > 160 {
                    return Err(InstallError::Limit);
                }
                let version_entry = io(version_entry)?;
                let version = version_entry.file_name().to_string_lossy().into_owned();
                if !catalog.rows().iter().any(|row| {
                    row.id.as_str() == id && row.version == version && row.manifest.is_some()
                }) {
                    return Err(InstallError::InUse);
                }
                if !io(version_entry.file_type())?.is_dir() {
                    return Err(InstallError::Storage);
                }
                for target_entry in io(fs::read_dir(version_entry.path()))? {
                    count += 1;
                    if count > 240 {
                        return Err(InstallError::Limit);
                    }
                    let target_entry = io(target_entry)?;
                    if target_entry.file_name() != "darwin-arm64"
                        || !io(target_entry.file_type())?.is_dir()
                    {
                        return Err(InstallError::InUse);
                    }
                }
            }
        }
        Ok(())
    }
    fn remove_locked(&self, catalog: &VerifiedCatalog, request: Request) -> Result<()> {
        if request.id == ComponentId::Node {
            self.unknown_software_blocks_shared_removal(catalog)?;
        }
        // Removal is finite even for corrupt receipts; software roots only, never agent-private.
        if !catalog
            .rows()
            .iter()
            .any(|r| r.id == request.id && r.version == request.version)
        {
            return Err(InstallError::Unavailable);
        }
        let _lease = self.exclusive_version(request.id, &request.version)?;
        for row in catalog.rows() {
            if let Some(m) = &row.manifest {
                if m.dependencies
                    .iter()
                    .any(|d| d.id == request.id && d.version == request.version)
                    && self
                        .inner
                        .roots
                        .version(m.id, &m.version)
                        .map_err(|_| InstallError::Storage)?
                        .exists()
                {
                    return Err(InstallError::InUse);
                }
            }
        }
        self.delete_software(&request)
    }
    fn delete_software(&self, request: &Request) -> Result<()> {
        if self.active_version(request.id)?.as_deref() == Some(request.version.as_str()) {
            let active = self
                .inner
                .roots
                .active()
                .join(format!("{}.json", request.id.as_str()));
            secure_unlink(&active)?;
            sync_dir(&self.inner.roots.active())?;
        }
        let path = self
            .inner
            .roots
            .version(request.id, &request.version)
            .map_err(|_| InstallError::Storage)?;
        if path.exists() {
            if io(fs::symlink_metadata(&path))?.file_type().is_symlink() {
                return Err(InstallError::Storage);
            }
            secure_remove_tree(&path)?;
            sync_dir(path.parent().unwrap())?;
        }
        Ok(())
    }
    fn removal_plan_locked(&self, catalog: &VerifiedCatalog) -> Result<RemovalPlan> {
        let mut components = Vec::new();
        // All installed agent versions first, shared runtime last. No filesystem path
        // from a caller or metadata URL enters removal.
        for id in [
            ComponentId::Codex,
            ComponentId::Opencode,
            ComponentId::Claude,
            ComponentId::Cursor,
            ComponentId::Node,
        ] {
            for row in catalog.rows().iter().filter(|row| row.id == id) {
                if self
                    .inner
                    .roots
                    .version(id, &row.version)
                    .map_err(|_| InstallError::Storage)?
                    .exists()
                {
                    components.push(Request {
                        id,
                        version: row.version.clone(),
                    });
                }
            }
        }
        let digest = sha256(
            &serde_json::to_vec(&(catalog.watermark(), &components))
                .map_err(|_| InstallError::Storage)?,
        );
        Ok(RemovalPlan {
            components,
            digest,
            catalog_revision: catalog.watermark().revision,
        })
    }
    pub fn removal_plan(&self) -> Result<RemovalPlan> {
        let _lock = MutationLock::acquire(&self.inner.roots)?;
        self.removal_plan_locked(&self.catalog(VerificationPurpose::InstalledReceipt)?)
    }
    pub fn remove_group(&self, reviewed: RemovalPlan, confirmed: bool) -> Result<()> {
        if !confirmed {
            return Err(InstallError::Confirmation);
        }
        let _lock = MutationLock::acquire(&self.inner.roots)?;
        let catalog = self.catalog(VerificationPurpose::InstalledReceipt)?;
        let current = self.removal_plan_locked(&catalog)?;
        if reviewed.digest != current.digest
            || reviewed.catalog_revision != current.catalog_revision
            || serde_json::to_vec(&reviewed.components).ok()
                != serde_json::to_vec(&current.components).ok()
        {
            return Err(InstallError::Stale);
        }
        if current.components.iter().any(|r| r.id == ComponentId::Node) {
            self.unknown_software_blocks_shared_removal(&catalog)?;
        }
        let mut leases = Vec::new();
        for request in &current.components {
            leases.push(self.exclusive_version(request.id, &request.version)?);
            // Preflight the entire owned tree before deleting any component.
            disk_bytes(
                &self
                    .inner
                    .roots
                    .version(request.id, &request.version)
                    .map_err(|_| InstallError::Storage)?,
            )?;
        }
        for request in &current.components {
            self.delete_software(request)?;
        }
        Ok(())
    }
    pub fn recover(&self) -> Result<()> {
        let _lock = MutationLock::acquire(&self.inner.roots)?;
        self.recover_locked()?;
        let path = self.inner.roots.software.join("current-job.json");
        if path.exists() {
            let mut disk: DurableJob = serde_json::from_slice(&bounded_read(&path, 8192)?)
                .map_err(|_| InstallError::Integrity)?;
            if disk.owner.len() > 128
                || disk.digest.len() != 64
                || disk.status.operation_id.len() > 128
            {
                return Err(InstallError::Integrity);
            }
            if !terminal(disk.status.state) {
                disk.status.state = JobState::Failed;
                disk.status.error = Some(InstallError::Shutdown);
                disk.status.sequence += 1;
                atomic_json(&path, &disk)?;
            }
        }
        Ok(())
    }
    fn disk_accounting(&self, catalog: &VerifiedCatalog) -> Result<DiskAccounting> {
        let mut disk = DiskAccounting {
            active_bytes: 0,
            retained_bytes: 0,
            shared_bytes: 0,
            staging_bytes: disk_bytes(&self.inner.roots.staging())?,
            cache_bytes: disk_bytes(&self.inner.roots.cache())?,
            active_budget_bytes: ACTIVE_BUDGET,
            cache_budget_bytes: CACHE_BUDGET,
            retained_per_component: RETAINED_PER_COMPONENT,
            unrecognized_bytes: 0,
        };
        for row in catalog.rows() {
            let path = self
                .inner
                .roots
                .version(row.id, &row.version)
                .map_err(|_| InstallError::Storage)?;
            let bytes = disk_bytes(&path)?;
            let bucket = if row.id == ComponentId::Node {
                &mut disk.shared_bytes
            } else if self.active_version(row.id)?.as_deref() == Some(row.version.as_str()) {
                &mut disk.active_bytes
            } else {
                &mut disk.retained_bytes
            };
            *bucket = bucket.checked_add(bytes).ok_or(InstallError::Limit)?;
        }
        let all_versions = disk_bytes(&self.inner.roots.software.join("versions"))?;
        let known = disk.active_bytes + disk.retained_bytes + disk.shared_bytes;
        disk.unrecognized_bytes = all_versions.saturating_sub(known);
        Ok(disk)
    }
    /// Retention applies only to authenticated software identities. Lease and dependency
    /// guards are reacquired by each finite removal; no private/native root is traversed.
    pub fn clean_retained(&self) -> Result<()> {
        let _lock = MutationLock::acquire(&self.inner.roots)?;
        let catalog = self.catalog(VerificationPurpose::InstalledReceipt)?;
        self.clean_retained_locked(&catalog)
    }
    fn clean_retained_locked(&self, catalog: &VerifiedCatalog) -> Result<()> {
        for id in [
            ComponentId::Codex,
            ComponentId::Opencode,
            ComponentId::Claude,
            ComponentId::Cursor,
            ComponentId::Node,
        ] {
            let active = self.active_version(id)?;
            let mut retained = catalog
                .rows()
                .iter()
                .filter(|r| r.id == id && active.as_deref() != Some(r.version.as_str()))
                .filter(|r| {
                    self.inner
                        .roots
                        .version(id, &r.version)
                        .is_ok_and(|p| p.exists())
                })
                .collect::<Vec<_>>();
            retained.sort_by(|a, b| version_parts(&b.version).cmp(&version_parts(&a.version)));
            for row in retained.into_iter().skip(RETAINED_PER_COMPONENT) {
                match self.remove_locked(
                    catalog,
                    Request {
                        id,
                        version: row.version.clone(),
                    },
                ) {
                    Ok(()) | Err(InstallError::InUse) => {}
                    Err(e) => return Err(e),
                }
            }
        }
        Ok(())
    }
    pub fn clean_cache(&self) -> Result<()> {
        let _lock = MutationLock::acquire(&self.inner.roots)?;
        self.recover_locked()
    }
    pub fn diagnostics(&self, owner: &str) -> Result<Diagnostics> {
        let catalog = self.catalog(VerificationPurpose::InstalledReceipt)?;
        let mut jobs = self
            .inner
            .jobs
            .lock()
            .map_err(|_| InstallError::Storage)?
            .values()
            .map(|j| j.status.clone())
            .collect::<Vec<_>>();
        let path = self.inner.roots.software.join("current-job.json");
        if path.exists() {
            if let Ok(bytes) = bounded_read(&path, 8192) {
                if let Ok(disk) = serde_json::from_slice::<DurableJob>(&bytes) {
                    if !jobs
                        .iter()
                        .any(|j| j.operation_id == disk.status.operation_id)
                    {
                        jobs.push(disk.status);
                    }
                }
            }
        }
        let _ = owner;
        Ok(Diagnostics {
            catalog_revision: catalog.watermark().revision,
            target: target(),
            components: self.inventory(&catalog),
            jobs,
            disk: self.disk_accounting(&catalog)?,
        })
    }
    pub fn shutdown(&self) {
        self.inner.shutdown.store(true, Ordering::Release);
        if let Ok(jobs) = self.inner.jobs.lock() {
            for job in jobs.values() {
                job.cancel.store(true, Ordering::Release);
            }
        }
        if let Ok(mut threads) = self.inner.threads.lock() {
            for thread in threads.drain(..) {
                let _ = thread.join();
            }
        }
    }
}
fn version_parts(version: &str) -> Vec<u64> {
    version.split('.').map(|v| v.parse().unwrap_or(0)).collect()
}
fn tested_version_newer(candidate: &str, current: &str) -> bool {
    // Only numeric exact tested versions are ordered; prerelease ambiguity offers no update.
    [candidate, current].iter().all(|v| {
        v.split('.')
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
    }) && version_parts(candidate) > version_parts(current)
}
/// Actual allocated filesystem blocks (shared runtime counted once), never manifest estimates.
fn disk_bytes(root: &Path) -> Result<u64> {
    if !root.try_exists().map_err(|_| InstallError::Storage)? {
        return Ok(0);
    }
    safe_ancestors(root)?;
    let mut stack = vec![root.to_path_buf()];
    let mut bytes = 0u64;
    let mut count = 0;
    while let Some(path) = stack.pop() {
        count += 1;
        if count > MAX_FILES * 6 {
            return Err(InstallError::Limit);
        }
        let metadata = io(fs::symlink_metadata(&path))?;
        if metadata.file_type().is_symlink() {
            return Err(InstallError::Storage);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            bytes = bytes
                .checked_add(
                    metadata
                        .blocks()
                        .checked_mul(512)
                        .ok_or(InstallError::Limit)?,
                )
                .ok_or(InstallError::Limit)?;
        }
        #[cfg(not(unix))]
        {
            bytes = bytes
                .checked_add(metadata.len())
                .ok_or(InstallError::Limit)?;
        }
        if metadata.is_dir() {
            for entry in io(fs::read_dir(&path))? {
                stack.push(io(entry)?.path());
            }
        } else if !metadata.is_file() {
            return Err(InstallError::Storage);
        }
    }
    Ok(bytes)
}
async fn fetch_catalog(endpoint: &str) -> Result<Vec<u8>> {
    #[cfg(test)]
    let loopback = endpoint.starts_with("http://127.0.0.1:");
    #[cfg(not(test))]
    let loopback = false;
    if (!endpoint.starts_with("https://") && !loopback) || endpoint.contains(['?', '#', '@']) {
        return Err(InstallError::Network);
    }
    let client = reqwest::Client::builder()
        .https_only(!loopback)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| InstallError::Network)?;
    let mut response = client
        .get(endpoint)
        .send()
        .await
        .map_err(|_| InstallError::Network)?;
    if response.status().is_redirection() {
        return Err(InstallError::Redirect);
    }
    if response.status() != reqwest::StatusCode::OK {
        return Err(InstallError::Http);
    }
    let limit = crate::component_catalog::MAX_CATALOG_BYTES * 2 + 1024;
    if response.content_length().is_some_and(|n| n > limit as u64)
        || response
            .headers()
            .contains_key(reqwest::header::CONTENT_ENCODING)
    {
        return Err(InstallError::Limit);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| InstallError::Network)? {
        if bytes.len() + chunk.len() > limit {
            return Err(InstallError::Limit);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
fn terminal(state: JobState) -> bool {
    matches!(
        state,
        JobState::Installed | JobState::Failed | JobState::Cancelled
    )
}

async fn download(
    m: &ComponentManifest,
    destination: &Path,
    cancel: &AtomicBool,
    fixture_endpoint: Option<&str>,
    mut progress: impl FnMut(u64),
) -> Result<()> {
    let url = m.archive.url.clone();
    #[cfg(test)]
    let url = if let Some(origin) = fixture_endpoint {
        if !origin.starts_with("http://127.0.0.1:") {
            return Err(InstallError::Network);
        }
        format!(
            "{}/{}",
            origin,
            url.rsplit('/').next().ok_or(InstallError::Network)?
        )
    } else {
        url
    };
    #[cfg(not(test))]
    {
        if fixture_endpoint.is_some() {
            return Err(InstallError::Network);
        }
    }
    let builder = reqwest::Client::builder().https_only(true);
    #[cfg(test)]
    let builder = builder.https_only(fixture_endpoint.is_none());
    let client = builder
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| InstallError::Network)?;
    check(cancel)?;
    let response = tokio::time::timeout(Duration::from_secs(5), client.get(url).send()).await;
    check(cancel)?;
    let mut response = response
        .map_err(|_| InstallError::Timeout)?
        .map_err(|_| InstallError::Network)?;
    if response.status().is_redirection() {
        return Err(InstallError::Redirect);
    }
    if response.status() != reqwest::StatusCode::OK {
        return Err(InstallError::Http);
    }
    if response
        .content_length()
        .is_some_and(|n| n != m.archive.compressed_bytes)
    {
        return Err(InstallError::Integrity);
    }
    if response
        .headers()
        .contains_key(reqwest::header::CONTENT_ENCODING)
    {
        return Err(InstallError::Integrity);
    }
    let mut file = secure_open(destination, SecureMode::New)?;
    let mut total = 0u64;
    let mut hash = Sha256::new();
    let began = Instant::now();
    let mut last = Instant::now();
    loop {
        check(cancel)?;
        if began.elapsed() > Duration::from_secs(30) {
            return Err(InstallError::Timeout);
        }
        let chunk = tokio::time::timeout(Duration::from_secs(2), response.chunk()).await;
        check(cancel)?;
        let chunk = chunk
            .map_err(|_| InstallError::Timeout)?
            .map_err(|_| InstallError::Network)?;
        let Some(chunk) = chunk else {
            break;
        };
        total = total
            .checked_add(chunk.len() as u64)
            .ok_or(InstallError::Limit)?;
        if total > m.archive.compressed_bytes {
            return Err(InstallError::Limit);
        }
        hash.update(&chunk);
        io(file.write_all(&chunk))?;
        if last.elapsed() > Duration::from_millis(100) {
            progress(total);
            last = Instant::now();
        }
    }
    if total != m.archive.compressed_bytes || format!("{:x}", hash.finalize()) != m.archive.sha256 {
        return Err(InstallError::Integrity);
    }
    io(file.sync_all())?;
    progress(total);
    Ok(())
}
fn native_target(bytes: &[u8]) -> bool {
    bytes.len() >= 8 && bytes[..4] == [0xcf, 0xfa, 0xed, 0xfe] && bytes[4..8] == [0x0c, 0, 0, 1]
}
fn extract(
    archive: &Path,
    destination: &Path,
    m: &ComponentManifest,
    cancel: &AtomicBool,
    fixture: bool,
) -> Result<()> {
    if !matches!(m.archive.format, ArchiveFormat::TarGz) {
        return Err(InstallError::UnsafeArchive);
    }
    let file = secure_open(archive, SecureMode::Archive)?;
    let decoder = flate2::bufread::GzDecoder::new(std::io::BufReader::new(file));
    // Includes tar headers/padding. Limit even directory/header expansion, independent of signed payload sum.
    let tar_limit = m
        .archive
        .unpacked_bytes
        .checked_add((MAX_FILES as u64) * 1024 + 4096)
        .ok_or(InstallError::Limit)?;
    let mut tar = tar::Archive::new(decoder.take(tar_limit));
    let expected = m
        .files
        .iter()
        .map(|f| (f.path.as_str(), f))
        .collect::<BTreeMap<_, _>>();
    let mut seen = BTreeSet::new();
    let mut count = 0;
    let entries = tar
        .entries()
        .map_err(|_| InstallError::UnsafeArchive)?
        .raw(true);
    for entry in entries {
        check(cancel)?;
        count += 1;
        if count > MAX_FILES {
            return Err(InstallError::Limit);
        }
        let mut entry = entry.map_err(|_| InstallError::UnsafeArchive)?;
        // Raw headers: no GNU/PAX longname extensions or links/special files are accepted.
        if !entry.header().entry_type().is_file() {
            return Err(InstallError::UnsafeArchive);
        }
        let path = std::str::from_utf8(&entry.path_bytes())
            .map_err(|_| InstallError::UnsafeArchive)?
            .to_string();
        if path == "receipt.json" || !safe_relative_path(&path) || !seen.insert(path.clone()) {
            return Err(InstallError::UnsafeArchive);
        }
        let expected = expected
            .get(path.as_str())
            .ok_or(InstallError::UnsafeArchive)?;
        if entry.size() != expected.bytes {
            return Err(InstallError::Integrity);
        }
        let file_path = destination.join(&path);
        private_dir(file_path.parent().ok_or(InstallError::UnsafeArchive)?)?;
        let mut output = secure_open(&file_path, SecureMode::New)?;
        let mut hash = Sha256::new();
        let mut head = Vec::new();
        let mut written = 0u64;
        let mut buffer = [0u8; 65536];
        loop {
            check(cancel)?;
            let n = entry
                .read(&mut buffer)
                .map_err(|_| InstallError::UnsafeArchive)?;
            if n == 0 {
                break;
            }
            written += n as u64;
            if written > expected.bytes {
                return Err(InstallError::Limit);
            }
            if head.len() < 8 {
                head.extend_from_slice(&buffer[..n.min(8 - head.len())]);
            }
            hash.update(&buffer[..n]);
            io(output.write_all(&buffer[..n]))?;
        }
        if written != expected.bytes || format!("{:x}", hash.finalize()) != expected.sha256 {
            return Err(InstallError::Integrity);
        }
        if (expected.executable || path.ends_with(".node") || path.ends_with(".dylib"))
            && !native_target(&head)
        {
            #[cfg(test)]
            {
                if !fixture || !head.starts_with(b"#!/bin/s") {
                    return Err(InstallError::Target);
                }
            }
            #[cfg(not(test))]
            {
                let _ = fixture;
                return Err(InstallError::Target);
            }
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            io(
                output.set_permissions(fs::Permissions::from_mode(if expected.executable {
                    0o500
                } else {
                    0o400
                })),
            )?;
        }
        io(output.sync_all())?;
    }
    if seen.len() != expected.len() {
        return Err(InstallError::Integrity);
    }
    // Consume gzip footer and reject additional compressed members/trailing garbage.
    let mut remaining = tar.into_inner();
    let mut tail = [0u8; 8192];
    let mut padding = 0;
    loop {
        check(cancel)?;
        let n = remaining
            .read(&mut tail)
            .map_err(|_| InstallError::Integrity)?;
        if n == 0 {
            break;
        }
        padding += n;
        // USTAR writers pad to a bounded 20-block (10 KiB) record.
        if padding > 10240 || tail[..n].iter().any(|b| *b != 0) {
            return Err(InstallError::UnsafeArchive);
        }
    }
    if remaining.limit() == 0 {
        return Err(InstallError::Limit);
    }
    let decoder = remaining.into_inner();
    let mut file = decoder.into_inner();
    let position = std::io::Seek::stream_position(&mut file).map_err(|_| InstallError::Storage)?;
    if position != m.archive.compressed_bytes {
        return Err(InstallError::Integrity);
    }
    Ok(())
}
fn validate_inventory(root: &Path, m: &ComponentManifest, cancel: &AtomicBool) -> Result<()> {
    safe_ancestors(root)?;
    let directories = m
        .files
        .iter()
        .flat_map(|file| {
            let mut prefixes = Vec::new();
            let mut prefix = String::new();
            let parts = file.path.split('/').collect::<Vec<_>>();
            for part in &parts[..parts.len() - 1] {
                if !prefix.is_empty() {
                    prefix.push('/');
                }
                prefix.push_str(part);
                prefixes.push(prefix.clone());
            }
            prefixes
        })
        .collect::<BTreeSet<_>>();
    let mut visited = 0usize;
    let mut found = BTreeSet::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        visited += 1;
        if visited > directories.len() + 1 {
            return Err(InstallError::Limit);
        }
        if dir != root {
            let relative = dir
                .strip_prefix(root)
                .map_err(|_| InstallError::Integrity)?
                .to_str()
                .ok_or(InstallError::Integrity)?;
            if !directories.contains(relative) {
                return Err(InstallError::Integrity);
            }
        }
        let meta = io(fs::symlink_metadata(&dir))?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err(InstallError::Integrity);
        }
        private_dir(&dir)?;
        for entry in io(fs::read_dir(&dir))? {
            check(cancel)?;
            let entry = io(entry)?;
            let meta = io(entry.file_type())?;
            let path = entry.path();
            if meta.is_symlink() {
                return Err(InstallError::Integrity);
            }
            if meta.is_dir() {
                stack.push(path);
            } else if meta.is_file() {
                let relative = path
                    .strip_prefix(root)
                    .map_err(|_| InstallError::Integrity)?
                    .to_str()
                    .ok_or(InstallError::Integrity)?
                    .to_string();
                if relative == "receipt.json" {
                    continue;
                }
                if !found.insert(relative) || found.len() > MAX_FILES {
                    return Err(InstallError::Integrity);
                }
            } else {
                return Err(InstallError::Integrity);
            }
        }
    }
    if found.len() != m.files.len() {
        return Err(InstallError::Integrity);
    }
    for expected in &m.files {
        check(cancel)?;
        if !found.contains(&expected.path) {
            return Err(InstallError::Integrity);
        }
        let path = root.join(&expected.path);
        let mut file = secure_open(&path, SecureMode::Read)?;
        let metadata = io(file.metadata())?;
        if metadata.len() != expected.bytes {
            return Err(InstallError::Integrity);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o777
                != if expected.executable { 0o500 } else { 0o400 }
            {
                return Err(InstallError::Integrity);
            }
        }
        let mut hash = Sha256::new();
        let mut buffer = [0u8; 65536];
        loop {
            check(cancel)?;
            let n = io(file.read(&mut buffer))?;
            if n == 0 {
                break;
            }
            hash.update(&buffer[..n]);
        }
        if format!("{:x}", hash.finalize()) != expected.sha256 {
            return Err(InstallError::Integrity);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let observed = io(secure_open(&path, SecureMode::Read)?.metadata())?;
            if observed.ino() != metadata.ino()
                || observed.dev() != metadata.dev()
                || observed.mtime() != metadata.mtime()
                || observed.mtime_nsec() != metadata.mtime_nsec()
            {
                return Err(InstallError::Integrity);
            }
        }
    }
    Ok(())
}
fn sync_tree(root: &Path) -> Result<()> {
    for entry in io(fs::read_dir(root))? {
        let path = io(entry)?.path();
        if path.is_dir() {
            sync_tree(&path)?;
        }
    }
    sync_dir(root)
}
fn probe(root: &Path, m: &ComponentManifest, cancel: &AtomicBool, fixture: bool) -> Result<()> {
    // SDK-only packages are inventory checked here; their no-account import probes belong to E.
    let key = if m.id == ComponentId::Claude {
        "native"
    } else {
        "main"
    };
    let entry = m.entries.get(key).ok_or(InstallError::Probe)?;
    if !m.files.iter().any(|f| f.path == *entry && f.executable) {
        return Ok(());
    }
    let mut command = std::process::Command::new(root.join(entry));
    let home = root.parent().ok_or(InstallError::Probe)?.join("probe-home");
    private_dir(&home)?;
    command
        .arg("--version")
        .current_dir(&home)
        .env_clear()
        .env("HOME", &home)
        .env("TMPDIR", &home)
        .env("PATH", "/usr/bin:/bin")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|_| InstallError::Probe)?;
    let stdout = child.stdout.take().ok_or(InstallError::Probe)?;
    let stderr = child.stderr.take().ok_or(InstallError::Probe)?;
    let (tx, rx) = std::sync::mpsc::channel();
    let tx_out = tx.clone();
    let output = thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout.take(4097).read_to_end(&mut bytes);
        let _ = tx_out.send(result.is_err() || bytes.len() > 4096);
        bytes
    });
    let errors = thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stderr.take(4097).read_to_end(&mut bytes);
        let overflow = result.is_err() || bytes.len() > 4096;
        let _ = tx.send(overflow);
        overflow
    });
    let began = Instant::now();
    let result = loop {
        if rx.try_iter().any(|overflow| overflow) {
            break Err(InstallError::Probe);
        }
        if cancel.load(Ordering::Acquire) {
            break Err(InstallError::Cancelled);
        }
        if began.elapsed() > Duration::from_secs(5) {
            break Err(InstallError::Probe);
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                break if status.success() {
                    Ok(())
                } else {
                    Err(InstallError::Probe)
                }
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(_) => break Err(InstallError::Probe),
        }
    };
    #[cfg(unix)]
    {
        let _ = nix::sys::signal::kill(
            nix::unistd::Pid::from_raw(-(child.id() as i32)),
            nix::sys::signal::Signal::SIGKILL,
        );
    }
    let _ = child.kill();
    let _ = child.wait();
    let bytes = output.join().map_err(|_| InstallError::Probe)?;
    let stderr_overflow = errors.join().map_err(|_| InstallError::Probe)?;
    result?;
    if bytes.len() > 4096 || stderr_overflow {
        return Err(InstallError::Probe);
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| InstallError::Probe)?;
    #[cfg(test)]
    if fixture {
        return if text.trim() == "SpecOps fixture ready" {
            Ok(())
        } else {
            Err(InstallError::Probe)
        };
    }
    #[cfg(not(test))]
    let _ = fixture;
    let expected = if m.id == ComponentId::Node {
        format!("v{}", m.version)
    } else if m.id == ComponentId::Claude {
        "2.1.289".to_string()
    } else {
        m.version.clone()
    };
    if text.split_whitespace().any(|token| token == expected) {
        Ok(())
    } else {
        Err(InstallError::Probe)
    }
}

#[tauri::command]
pub async fn component_refresh_catalog(manager: tauri::State<'_, ComponentManager>) -> Result<u64> {
    manager.refresh_catalog().await
}
#[tauri::command]
pub fn component_list(manager: tauri::State<'_, ComponentManager>) -> Result<Vec<InventoryRow>> {
    manager.list()
}
#[tauri::command]
pub fn component_plan(
    window: tauri::Window,
    manager: tauri::State<'_, ComponentManager>,
    request: Request,
) -> Result<Plan> {
    manager.plan(window.label(), request)
}
#[tauri::command]
pub fn component_install(
    window: tauri::Window,
    app: tauri::AppHandle,
    manager: tauri::State<'_, ComponentManager>,
    confirmation: Confirmation,
) -> Result<JobStatus> {
    manager.install(window.label(), confirmation, Some(app))
}
#[tauri::command]
pub fn component_cancel(
    window: tauri::Window,
    manager: tauri::State<'_, ComponentManager>,
    operation_id: String,
    generation: u64,
) -> Result<JobStatus> {
    manager.cancel(window.label(), &operation_id, generation)
}
#[tauri::command]
pub fn component_retry(
    window: tauri::Window,
    app: tauri::AppHandle,
    manager: tauri::State<'_, ComponentManager>,
    operation_id: String,
    generation: u64,
    confirmation: Confirmation,
) -> Result<JobStatus> {
    manager.retry(
        window.label(),
        &operation_id,
        generation,
        confirmation,
        Some(app),
    )
}
#[tauri::command]
pub fn component_update(
    window: tauri::Window,
    manager: tauri::State<'_, ComponentManager>,
    request: Request,
) -> Result<Plan> {
    manager.plan(window.label(), request)
}
#[tauri::command]
pub fn component_select(
    manager: tauri::State<'_, ComponentManager>,
    request: Request,
) -> Result<()> {
    manager.select(request)
}
#[tauri::command]
pub fn component_remove(
    manager: tauri::State<'_, ComponentManager>,
    request: Request,
) -> Result<()> {
    manager.remove(request)
}
#[tauri::command]
pub fn component_removal_plan(manager: tauri::State<'_, ComponentManager>) -> Result<RemovalPlan> {
    manager.removal_plan()
}
#[tauri::command]
pub fn component_remove_group(
    manager: tauri::State<'_, ComponentManager>,
    plan: RemovalPlan,
    confirmed: bool,
) -> Result<()> {
    manager.remove_group(plan, confirmed)
}
#[tauri::command]
pub fn component_clean_retained(manager: tauri::State<'_, ComponentManager>) -> Result<()> {
    manager.clean_retained()
}
#[tauri::command]
pub fn component_clean_cache(manager: tauri::State<'_, ComponentManager>) -> Result<()> {
    manager.clean_cache()
}
#[tauri::command]
pub fn component_diagnostics(
    window: tauri::Window,
    manager: tauri::State<'_, ComponentManager>,
) -> Result<Diagnostics> {
    manager.diagnostics(window.label())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::component_catalog::TrustPolicy;
    use std::net::{TcpListener, TcpStream};
    fn catalog() -> VerifiedCatalog {
        VerifiedCatalog::verify(
            include_bytes!("../fixtures/components/distribution/catalog.json"),
            &TrustPolicy::fixture(),
            1791709200,
            VerificationPurpose::NewInstall,
            None,
        )
        .unwrap()
    }
    pub(crate) struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!(
                "specops-install-{}-{}",
                std::process::id(),
                GENERATION.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&p).unwrap();
            Self(fs::canonicalize(p).unwrap())
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn manager(temp: &Temp) -> ComponentManager {
        let manager = ComponentManager::new(&temp.0);
        manager.inner.fixture_catalog.store(true, Ordering::Relaxed);
        manager
    }
    fn request(id: ComponentId) -> Request {
        let c = catalog();
        let m = c.rows().iter().find(|r| r.id == id).unwrap();
        Request {
            id,
            version: m.version.clone(),
        }
    }
    fn archive(m: &ComponentManifest) -> Vec<u8> {
        fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("fixtures/components/distribution")
                .join(m.archive.url.rsplit('/').next().unwrap()),
        )
        .unwrap()
    }
    struct Server {
        origin: String,
        stop: Arc<AtomicBool>,
        thread: Option<thread::JoinHandle<()>>,
    }
    impl Server {
        fn new(fault: &str) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let origin = format!("http://{}", listener.local_addr().unwrap());
            listener.set_nonblocking(true).unwrap();
            let stop = Arc::new(AtomicBool::new(false));
            let stopping = stop.clone();
            let fault = fault.to_string();
            let worker = thread::spawn(move || {
                while !stopping.load(Ordering::Acquire) {
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            // Accepted sockets may inherit nonblocking mode on Darwin.
                            // Header reads use the explicit bounded blocking timeout.
                            stream.set_nonblocking(false).unwrap();
                            serve(&mut stream, &fault);
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(5))
                        }
                        Err(_) => break,
                    }
                }
            });
            Self {
                origin,
                stop,
                thread: Some(worker),
            }
        }
    }
    impl Drop for Server {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Release);
            if let Some(t) = self.thread.take() {
                let _ = t.join();
            }
        }
    }
    fn serve(stream: &mut TcpStream, fault: &str) {
        stream
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        let mut request = Vec::new();
        let mut buffer = [0u8; 1024];
        while request.len() < 8192 && !request.ends_with(b"\r\n\r\n") {
            let n = stream.read(&mut buffer).unwrap_or(0);
            if n == 0 {
                return;
            }
            request.extend_from_slice(&buffer[..n]);
        }
        let text = String::from_utf8_lossy(&request);
        if fault == "redirect" {
            let _=stream.write_all(b"HTTP/1.1 302 Found\r\nLocation: https://user:secret@evil.invalid/x\r\nContent-Length: 0\r\n\r\n");
            return;
        }
        if fault == "http" {
            let _ = stream.write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n");
            return;
        }
        let file = text
            .split_whitespace()
            .nth(1)
            .unwrap_or("")
            .trim_start_matches('/');
        assert!(!text.to_ascii_lowercase().contains("authorization:"));
        assert!(!text.to_ascii_lowercase().contains("cookie:"));
        assert!(!text.contains("credential-canary"));
        let file = if fault == "metadata-revoked" && file == "catalog.json" {
            "revoked-catalog.json".to_owned()
        } else if fault == "update" {
            file.replace("codex-0.160.1", "codex-0.160.0")
                .replace("codex-0.160.2", "codex-0.160.0")
        } else {
            file.to_owned()
        };
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures/components/distribution")
            .join(file);
        let mut body = fs::read(path).unwrap_or_default();
        if fault == "corrupt" && !body.is_empty() {
            body[0] ^= 1;
        }
        let length = body.len();
        if fault == "oversized" {
            body.push(0);
        }
        if fault == "truncated" {
            body.truncate(body.len() / 2);
        }
        let declared = if fault == "oversized" {
            body.len()
        } else {
            length
        };
        let _ = write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            declared
        );
        if fault == "slow" {
            thread::sleep(Duration::from_millis(2300));
        }
        let _ = stream.write_all(&body);
    }
    pub(crate) fn installed_manager(id: ComponentId) -> (Temp, ComponentManager) {
        let temp = Temp::new();
        let manager = manager(&temp);
        let c = catalog();
        let _lock = MutationLock::acquire(&manager.inner.roots).unwrap();
        manager.persist_catalog(&c).unwrap();
        let server = Server::new("");
        let m = c
            .rows()
            .iter()
            .find(|r| r.id == id)
            .unwrap()
            .manifest
            .as_ref()
            .unwrap();
        let manifests = if id == ComponentId::Node {
            vec![m.clone()]
        } else {
            vec![c.rows()[0].manifest.clone().unwrap(), m.clone()]
        };
        manager
            .run_install(
                "fixture-job",
                &c,
                &manifests,
                &AtomicBool::new(false),
                None,
                Some(&server.origin),
            )
            .unwrap();
        drop(_lock);
        (temp, manager)
    }
    #[test]
    #[ignore = "Requires explicit real finite candidates, test-only catalog server and CI-built managed probe"]
    fn real_candidate_native_installer_managed_probe() {
        let source = PathBuf::from(
            std::env::var("SPECOPS_TEST_CANDIDATE_ROOT")
                .expect("Explicit test candidates required"),
        );
        let origin = std::env::var("SPECOPS_TEST_CANDIDATE_ORIGIN")
            .expect("Explicit loopback test endpoint required");
        assert!(origin.starts_with("http://127.0.0.1:"));
        let probe = fs::canonicalize(
            std::env::var("SPECOPS_TEST_MANAGED_PROBE").expect("Explicit CI probe required"),
        )
        .unwrap();
        let c = VerifiedCatalog::verify(
            &fs::read(source.join("catalog.json")).unwrap(),
            &TrustPolicy::fixture(),
            now(),
            VerificationPurpose::NewInstall,
            None,
        )
        .unwrap();
        let temp = Temp::new();
        let manager = manager(&temp);
        let manifests = c
            .rows()
            .iter()
            .map(|r| r.manifest.clone().unwrap())
            .collect::<Vec<_>>();
        manager.persist_catalog(&c).unwrap();
        for m in &manifests {
            println!("Installing real candidate {}", m.id.as_str());
            manager
                .run_install(
                    "real-vendor-test",
                    &c,
                    &[m.clone()],
                    &AtomicBool::new(false),
                    None,
                    Some(&origin),
                )
                .unwrap();
        }
        let roots = manifests
            .iter()
            .map(|m| (m.id.as_str(), manager.ready(&c, m).unwrap()))
            .collect::<BTreeMap<_, _>>();
        atomic_json(&temp.0.join("manifest-roots.json"), &roots).unwrap();
        atomic_json(&temp.0.join("manifests.json"), &manifests).unwrap();
        let node = roots.get("node").unwrap().join("node");
        let output = std::process::Command::new(node)
            .arg(probe)
            .arg(&temp.0)
            .current_dir(&temp.0)
            .env_clear()
            .env("HOME", &temp.0)
            .env("PATH", "/usr/bin:/bin")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "Managed source probe failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        println!(
            "Native test-only authenticated candidate install: {}",
            String::from_utf8_lossy(&output.stdout)
        );
    }
    #[test]
    fn independent_agents_reuse_node_and_failed_sibling_preserves_healthy_software() {
        let (_temp, manager) = installed_manager(ComponentId::Codex);
        let c = catalog();
        let node = c.rows()[0].manifest.as_ref().unwrap();
        let before = fs::read(manager.ready(&c, node).unwrap().join("receipt.json")).unwrap();
        let plan = manager
            .plan_verified("primary", request(ComponentId::Claude), &c)
            .unwrap();
        let claude = c
            .rows()
            .iter()
            .find(|r| r.id == ComponentId::Claude)
            .unwrap()
            .manifest
            .as_ref()
            .unwrap();
        assert_eq!(plan.download_bytes, claude.archive.compressed_bytes);
        let fault = Server::new("corrupt");
        assert!(manager
            .run_install(
                "sibling-fault",
                &c,
                &[node.clone(), claude.clone()],
                &AtomicBool::new(false),
                None,
                Some(&fault.origin)
            )
            .is_err());
        assert_eq!(
            fs::read(manager.ready(&c, node).unwrap().join("receipt.json")).unwrap(),
            before
        );
        let codex = c
            .rows()
            .iter()
            .find(|r| r.id == ComponentId::Codex)
            .unwrap()
            .manifest
            .as_ref()
            .unwrap();
        assert!(manager.ready(&c, codex).is_ok());
        assert!(matches!(
            manager.remove(request(ComponentId::Node)),
            Err(InstallError::InUse)
        ));
        // Remaining components can install independently against the retained prerequisite.
        let server = Server::new("");
        for id in [
            ComponentId::Opencode,
            ComponentId::Claude,
            ComponentId::Cursor,
        ] {
            let m = c
                .rows()
                .iter()
                .find(|r| r.id == id)
                .unwrap()
                .manifest
                .as_ref()
                .unwrap();
            manager
                .run_install(
                    "sibling-success",
                    &c,
                    &[node.clone(), m.clone()],
                    &AtomicBool::new(false),
                    None,
                    Some(&server.origin),
                )
                .unwrap();
            assert!(manager.ready(&c, m).is_ok());
            assert_eq!(
                fs::read(manager.ready(&c, node).unwrap().join("receipt.json")).unwrap(),
                before
            );
        }
        let reviewed = manager
            .plan_verified("primary", request(ComponentId::Claude), &c)
            .unwrap();
        assert_eq!(reviewed.download_bytes, 0);
        fs::remove_file(
            manager
                .ready(&c, node)
                .unwrap()
                .join(node.entries.get("main").unwrap()),
        )
        .unwrap();
        assert!(matches!(
            manager.install(
                "primary",
                Confirmation {
                    plan_id: reviewed.plan_id,
                    digest: reviewed.digest,
                    confirmed: true
                },
                None
            ),
            Err(InstallError::Stale)
        ));
    }
    fn maintenance_catalog(mutator: impl FnOnce(&mut serde_json::Value)) -> Vec<u8> {
        use ed25519_dalek::{Signer, SigningKey};
        let source: serde_json::Value = serde_json::from_slice(include_bytes!(
            "../fixtures/components/distribution/catalog.json"
        ))
        .unwrap();
        let hex = |value: &str| {
            (0..value.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&value[i..i + 2], 16).unwrap())
                .collect::<Vec<_>>()
        };
        let seed: [u8; 32] =
            hex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
                .try_into()
                .unwrap();
        let signer = SigningKey::from_bytes(&seed);
        let mut payload: serde_json::Value =
            serde_json::from_slice(&hex(source["payloadHex"].as_str().unwrap())).unwrap();
        mutator(&mut payload);
        for row in payload["rows"].as_array_mut().unwrap() {
            let Some(manifest) = row.get_mut("manifest").filter(|value| value.is_object()) else {
                continue;
            };
            let mut unsigned = manifest.clone();
            unsigned.as_object_mut().unwrap().remove("signature");
            let mut message = b"SpecOps component manifest v1\0".to_vec();
            message.extend(serde_json::to_vec(&unsigned).unwrap());
            manifest["signature"]["value"] = signer
                .sign(&message)
                .to_bytes()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
                .into();
        }
        let bytes = serde_json::to_vec(&payload).unwrap();
        let mut message = b"SpecOps component catalog v1\0".to_vec();
        message.extend(&bytes);
        serde_json::to_vec(&serde_json::json!({ "payloadHex": bytes.iter().map(|b| format!("{b:02x}")).collect::<String>(),
            "signature": { "algorithm": "ed25519", "keyId": "fixture-v1", "value": signer.sign(&message).to_bytes().iter().map(|b| format!("{b:02x}")).collect::<String>() } })).unwrap()
    }
    fn update_catalog(revision: u64, versions: &[&str], incompatible: bool) -> Vec<u8> {
        maintenance_catalog(|payload| {
            payload["revision"] = revision.into();
            let original = payload["rows"]
                .as_array()
                .unwrap()
                .iter()
                .find(|row| row["id"] == "codex")
                .unwrap()
                .clone();
            for version in versions {
                let mut row = original.clone();
                row["version"] = (*version).into();
                row["manifest"]["version"] = (*version).into();
                row["manifest"]["archive"]["url"] =
                    format!("https://fixtures.invalid/v1/codex-{version}-darwin-arm64.tar.gz")
                        .into();
                if incompatible {
                    row["manifest"]["compatibility"]["nativeStoreRevision"] = "unknown".into();
                }
                payload["rows"].as_array_mut().unwrap().push(row);
            }
        })
    }
    #[test]
    fn signed_updates_preserve_leased_identity_require_review_and_allow_only_known_store_rollback()
    {
        let (temp, manager) = installed_manager(ComponentId::Codex);
        let history = temp.0.join("agent-private/history-canary");
        private_dir(history.parent().unwrap()).unwrap();
        fs::write(&history, b"history-and-credentials").unwrap();
        let lease = manager.acquire_runtime(ComponentId::Codex).unwrap();
        let dropped = maintenance_catalog(|p| {
            p["revision"] = 2.into();
            p["rows"]
                .as_array_mut()
                .unwrap()
                .retain(|r| r["id"] != "codex");
        });
        assert_eq!(manager.accept_catalog(&dropped), Err(InstallError::Catalog));
        manager
            .accept_catalog(&update_catalog(2, &["0.160.1"], false))
            .unwrap();
        let rows = manager.list().unwrap();
        assert!(rows
            .iter()
            .any(|row| row.id == ComponentId::Codex && row.state == ComponentState::InUse));
        assert!(rows
            .iter()
            .any(|row| row.version == "0.160.1" && row.state == ComponentState::UpdateAvailable));
        manager.validate_launch(&lease).unwrap();
        let catalog = manager.catalog(VerificationPurpose::NewInstall).unwrap();
        let next = Request {
            id: ComponentId::Codex,
            version: "0.160.1".into(),
        };
        let plan = manager.plan("review-window", next.clone()).unwrap();
        assert_eq!(plan.catalog_revision, 2);
        assert!(plan.download_bytes > 0);
        let server = Server::new("update");
        let m = catalog
            .install_manifest(next.id, &next.version, &target())
            .unwrap()
            .clone();
        let lock = MutationLock::acquire(&manager.inner.roots).unwrap();
        assert_eq!(
            manager.run_install(
                "update-lease",
                &catalog,
                &[m],
                &AtomicBool::new(false),
                None,
                Some(&server.origin)
            ),
            Err(InstallError::InUse)
        );
        drop(lock);
        assert_eq!(
            manager.active_version(ComponentId::Codex).unwrap(),
            Some("0.160.0".into())
        );
        assert_eq!(manager.select(next.clone()), Err(InstallError::InUse));
        drop(lease);
        manager.select(next).unwrap();
        manager.select(request(ComponentId::Codex)).unwrap();
        assert_eq!(fs::read(&history).unwrap(), b"history-and-credentials");
        manager
            .accept_catalog(&maintenance_catalog(|p| {
                let envelope: serde_json::Value =
                    serde_json::from_slice(&update_catalog(3, &["0.160.1", "0.160.2"], false))
                        .unwrap();
                let value = envelope["payloadHex"].as_str().unwrap();
                let bytes = (0..value.len())
                    .step_by(2)
                    .map(|i| u8::from_str_radix(&value[i..i + 2], 16).unwrap())
                    .collect::<Vec<_>>();
                *p = serde_json::from_slice(&bytes).unwrap();
                let row = p["rows"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|r| r["version"] == "0.160.2")
                    .unwrap();
                row["manifest"]["compatibility"]["nativeStoreRevision"] = "unknown".into();
            }))
            .unwrap();
        assert_eq!(
            manager
                .plan(
                    "review-window",
                    Request {
                        id: ComponentId::Codex,
                        version: "0.160.2".into()
                    }
                )
                .unwrap_err(),
            InstallError::Catalog
        );
        assert!(manager
            .list()
            .unwrap()
            .iter()
            .any(|row| row.version == "0.160.2" && row.state == ComponentState::Incompatible));
    }
    #[test]
    fn actual_remote_metadata_transport_is_bounded_credential_free_and_production_endpoint_absent()
    {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (temp, manager) = installed_manager(ComponentId::Codex);
        let lease = manager.acquire_runtime(ComponentId::Codex).unwrap();
        let server = Server::new("metadata-revoked");
        let canary_name = "SPECOPS_PROVIDER_CREDENTIAL_CANARY";
        let old = std::env::var_os(canary_name);
        std::env::set_var(canary_name, "credential-canary");
        let bytes = runtime
            .block_on(fetch_catalog(&format!("{}/catalog.json", server.origin)))
            .unwrap();
        if let Some(value) = old {
            std::env::set_var(canary_name, value);
        } else {
            std::env::remove_var(canary_name);
        }
        assert_eq!(manager.accept_catalog(&bytes).unwrap(), 2);
        assert!(manager.validate_launch(&lease).is_err());
        for fault in ["redirect", "http", "truncated", "corrupt"] {
            let server = Server::new(fault);
            let result =
                runtime.block_on(fetch_catalog(&format!("{}/catalog.json", server.origin)));
            match result {
                Ok(bytes) => assert!(manager.accept_catalog(&bytes).is_err()),
                Err(error) => assert!(!format!("{error:?}").contains("credential-canary")),
            }
        }
        assert_eq!(
            runtime.block_on(fetch_catalog("http://evil.invalid/catalog.json")),
            Err(InstallError::Network)
        );
        assert_eq!(
            runtime.block_on(fetch_catalog(
                "https://user:credential-canary@evil.invalid/catalog.json"
            )),
            Err(InstallError::Network)
        );
        let production = super::ComponentManager::new(&temp.0.join("separate-production"));
        assert_eq!(
            runtime.block_on(production.refresh_catalog()),
            Err(InstallError::Unavailable)
        );
    }
    #[test]
    fn signed_revocation_replay_cached_offline_and_lease_launch_revalidation_fail_closed() {
        let (temp, manager) = installed_manager(ComponentId::Codex);
        let lease = manager.acquire_runtime(ComponentId::Codex).unwrap();
        manager.validate_launch(&lease).unwrap();
        let manifest = lease.manifest.clone();
        let executable = lease.root.join(manifest.entries.get("main").unwrap());
        let original = fs::read(&executable).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
        }
        fs::write(&executable, b"#!/bin/sh\nexit 0\n").unwrap();
        assert!(manager.validate_launch(&lease).is_err());
        fs::write(&executable, original).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&executable, fs::Permissions::from_mode(0o500)).unwrap();
        }
        manager.validate_launch(&lease).unwrap();
        let revoked = include_bytes!("../fixtures/components/distribution/revoked-catalog.json");
        manager.accept_catalog(revoked).unwrap();
        assert!(manager.validate_launch(&lease).is_err());
        assert!(manager.acquire_runtime(ComponentId::Codex).is_err());
        assert_eq!(
            manager.accept_catalog(include_bytes!(
                "../fixtures/components/distribution/catalog.json"
            )),
            Err(InstallError::Catalog)
        );
        assert_eq!(
            manager.accept_catalog(&maintenance_catalog(|p| p["revision"] = 3.into())),
            Err(InstallError::Catalog)
        );
        // A fresh manager reuses signed revocation; no embedded fallback resets its watermark.
        let reopened = super::ComponentManager::new(&temp.0);
        reopened
            .inner
            .fixture_catalog
            .store(true, Ordering::Relaxed);
        assert!(reopened.validate_launch(&lease).is_err());
        let cache = reopened.inner.roots.software.join("catalog-envelope.json");
        fs::write(cache, b"{\"untrusted\":true}").unwrap();
        assert!(reopened.list().is_err());
    }
    #[test]
    fn actual_accounting_cache_staging_ownership_group_removal_and_retention_budget() {
        let (temp, manager) = installed_manager(ComponentId::Codex);
        let history = temp.0.join("agent-private/history-canary");
        private_dir(history.parent().unwrap()).unwrap();
        fs::write(&history, b"preserved").unwrap();
        let stage = manager.inner.roots.staging().join("another-installer");
        private_dir(&stage).unwrap();
        fs::write(stage.join("partial"), vec![1; 8192]).unwrap();
        let unknown = manager.inner.roots.software.join("versions/unrecognized");
        private_dir(&unknown).unwrap();
        fs::write(unknown.join("canary"), vec![1; 8192]).unwrap();
        let lock = MutationLock::acquire(&manager.inner.roots).unwrap();
        assert_eq!(manager.clean_cache(), Err(InstallError::Busy));
        drop(lock);
        let accounting = manager.diagnostics("window").unwrap().disk;
        assert!(
            accounting.shared_bytes > 0
                && accounting.active_bytes > 0
                && accounting.staging_bytes >= 8192
                && accounting.unrecognized_bytes >= 8192
        );
        manager.clean_cache().unwrap();
        assert!(stage.join("partial").exists());
        assert!(unknown.join("canary").exists());
        manager
            .accept_catalog(&update_catalog(2, &["0.160.1", "0.160.2"], false))
            .unwrap();
        let catalog = manager.catalog(VerificationPurpose::NewInstall).unwrap();
        let server = Server::new("update");
        for version in ["0.160.1", "0.160.2"] {
            let m = catalog
                .install_manifest(ComponentId::Codex, version, &target())
                .unwrap()
                .clone();
            let _lock = MutationLock::acquire(&manager.inner.roots).unwrap();
            manager
                .run_install(
                    "retention-update",
                    &catalog,
                    &[m],
                    &AtomicBool::new(false),
                    None,
                    Some(&server.origin),
                )
                .unwrap();
        }
        assert!(!manager
            .inner
            .roots
            .version(ComponentId::Codex, "0.160.0")
            .unwrap()
            .exists());
        assert!(manager
            .inner
            .roots
            .version(ComponentId::Codex, "0.160.1")
            .unwrap()
            .exists());
        let blocked = manager.removal_plan().unwrap();
        assert_eq!(
            manager.remove_group(blocked, true),
            Err(InstallError::InUse)
        );
        assert!(unknown.join("canary").exists());
        secure_remove_tree(&unknown).unwrap(); // Fixture author removes only its own unknown sentinel.
        let lease = manager.acquire_runtime(ComponentId::Codex).unwrap();
        let review = manager.removal_plan().unwrap();
        assert_eq!(
            manager.remove_group(review.clone(), false),
            Err(InstallError::Confirmation)
        );
        assert_eq!(
            manager.remove_group(review.clone(), true),
            Err(InstallError::InUse)
        );
        assert!(manager.acquire_runtime(ComponentId::Node).is_ok());
        drop(lease);
        manager.remove_group(review, true).unwrap();
        assert!(manager
            .active_version(ComponentId::Codex)
            .unwrap()
            .is_none());
        assert!(manager.active_version(ComponentId::Node).unwrap().is_none());
        assert_eq!(fs::read(history).unwrap(), b"preserved");
        assert!(!unknown.exists());
    }
    #[cfg(unix)]
    #[test]
    fn fd_relative_store_mutations_reject_symlink_hardlink_permissions_and_concurrent_substitution()
    {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let (_temp, manager) = installed_manager(ComponentId::Node);
        let outside = Temp::new();
        let secret = outside.0.join("canary");
        fs::write(&secret, b"outside-never-touched").unwrap();
        let pending = manager.inner.roots.software.join("hardlink.pending");
        fs::hard_link(&secret, &pending).unwrap();
        assert!(atomic_json(
            &manager.inner.roots.software.join("hardlink.json"),
            &"overwrite"
        )
        .is_err());
        assert_eq!(fs::read(&secret).unwrap(), b"outside-never-touched");
        fs::remove_file(pending).unwrap();
        let alias = manager.inner.roots.software.join("alias");
        symlink(&outside.0, &alias).unwrap();
        assert!(atomic_json(&alias.join("canary"), &"overwrite").is_err());
        assert!(secure_remove_tree(&alias).is_err());
        assert!(private_dir(&alias.join("new")).is_err());
        assert!(!outside.0.join("new").exists());
        let receipt = manager
            .inner
            .roots
            .version(ComponentId::Node, "24.15.0")
            .unwrap()
            .join("receipt.json");
        let link = outside.0.join("receipt-link");
        fs::hard_link(&receipt, &link).unwrap();
        assert!(manager.acquire_runtime(ComponentId::Node).is_err());
        fs::remove_file(link).unwrap();
        fs::set_permissions(
            &manager.inner.roots.software,
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        assert!(manager.list().is_err());
        fs::set_permissions(
            &manager.inner.roots.software,
            fs::Permissions::from_mode(0o700),
        )
        .unwrap();
        let race = manager.inner.roots.software.join("race");
        private_dir(&race).unwrap();
        let moved = manager.inner.roots.software.join("held-race");
        let stopping = Arc::new(AtomicBool::new(false));
        let stop = stopping.clone();
        let external = outside.0.clone();
        let race_thread = race.clone();
        let moved_thread = moved.clone();
        let thread = thread::spawn(move || {
            while !stop.load(Ordering::Acquire) {
                if fs::rename(&race_thread, &moved_thread).is_ok() {
                    let _ = symlink(&external, &race_thread);
                    thread::yield_now();
                    let _ = fs::remove_file(&race_thread);
                    let _ = fs::rename(&moved_thread, &race_thread);
                }
            }
        });
        for _ in 0..200 {
            let _ = atomic_json(&race.join("canary"), &"owned");
            let _ = secure_unlink(&race.join("canary"));
        }
        stopping.store(true, Ordering::Release);
        thread.join().unwrap();
        assert_eq!(fs::read(&secret).unwrap(), b"outside-never-touched");
        assert!(!outside.0.join("canary.pending").exists());
    }
    #[test]
    fn all_five_signed_native_installs_receipts_and_atomic_recovery() {
        let temp = Temp::new();
        let manager = manager(&temp);
        let c = catalog();
        let _lock = MutationLock::acquire(&manager.inner.roots).unwrap();
        manager.persist_catalog(&c).unwrap();
        let server = Server::new("");
        let manifests = c
            .rows()
            .iter()
            .map(|r| r.manifest.clone().unwrap())
            .collect::<Vec<_>>();
        manager
            .run_install(
                "fixture-job",
                &c,
                &manifests,
                &AtomicBool::new(false),
                None,
                Some(&server.origin),
            )
            .unwrap();
        for m in &manifests {
            assert!(manager.ready(&c, m).is_ok());
            assert_eq!(
                manager.active_version(m.id).unwrap(),
                Some(m.version.clone())
            );
        }
        let interrupted = manager.inner.roots.staging().join("interrupted/content");
        private_dir(&interrupted).unwrap();
        fs::write(interrupted.join("evil"), b"partial").unwrap();
        atomic_json(
            &interrupted.parent().unwrap().join("owner.json"),
            &"interrupted",
        )
        .unwrap();
        manager.recover_locked().unwrap();
        assert!(!interrupted.exists());
        for m in &manifests {
            assert!(manager.ready(&c, m).is_ok());
        }
        let m = &manifests[0];
        let root = manager.inner.roots.version(m.id, &m.version).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(root.join("receipt.json"), fs::Permissions::from_mode(0o600))
                .unwrap();
        }
        fs::write(root.join("receipt.json"), b"{}").unwrap();
        assert!(manager.ready(&c, m).is_err());
        // No private account/history directory is read/written by any installer operation.
        assert!(!manager.inner.roots.private.exists());
    }
    #[test]
    fn confirmed_owned_finite_plans_and_stale_requests() {
        let temp = Temp::new();
        let manager = manager(&temp);
        let c = catalog();
        let _lock = MutationLock::acquire(&manager.inner.roots).unwrap();
        let plan = manager
            .plan_verified("primary", request(ComponentId::Cursor), &c)
            .unwrap();
        assert_eq!(plan.components.len(), 2);
        assert_eq!(
            plan.required_disk_bytes,
            RESERVE_BYTES
                + c.rows()[0]
                    .manifest
                    .as_ref()
                    .unwrap()
                    .archive
                    .compressed_bytes
                + c.rows()[0]
                    .manifest
                    .as_ref()
                    .unwrap()
                    .archive
                    .unpacked_bytes
                    * 2
                + c.rows()[4]
                    .manifest
                    .as_ref()
                    .unwrap()
                    .archive
                    .compressed_bytes
                + c.rows()[4]
                    .manifest
                    .as_ref()
                    .unwrap()
                    .archive
                    .unpacked_bytes
                    * 2
        );
        let confirmation = Confirmation {
            plan_id: plan.plan_id.clone(),
            digest: plan.digest.clone(),
            confirmed: false,
        };
        assert!(matches!(
            manager.start_verified("primary", confirmation, c, _lock, None, None),
            Err(InstallError::Confirmation)
        ));
        let _lock = MutationLock::acquire(&manager.inner.roots).unwrap();
        assert!(matches!(
            manager.start_verified(
                "foreign",
                Confirmation {
                    plan_id: plan.plan_id.clone(),
                    digest: plan.digest.clone(),
                    confirmed: true
                },
                catalog(),
                _lock,
                None,
                None
            ),
            Err(InstallError::Foreign)
        ));
        let _lock = MutationLock::acquire(&manager.inner.roots).unwrap();
        assert!(matches!(
            manager.start_verified(
                "primary",
                Confirmation {
                    plan_id: plan.plan_id,
                    digest: "0".repeat(64),
                    confirmed: true
                },
                catalog(),
                _lock,
                None,
                None
            ),
            Err(InstallError::Stale)
        ));
        assert!(!manager
            .inner
            .roots
            .version(ComponentId::Node, "24.15.0")
            .unwrap()
            .exists());
        assert!(serde_json::from_str::<Request>(
            r#"{"id":"node","version":"24.15.0","url":"https://secret@evil.invalid"}"#
        )
        .is_err());
    }
    #[test]
    fn network_faults_never_activate_or_disclose_credentials() {
        for (fault, expected) in [
            ("redirect", InstallError::Redirect),
            ("http", InstallError::Http),
            ("corrupt", InstallError::Integrity),
            ("truncated", InstallError::Network),
            ("oversized", InstallError::Integrity),
            ("slow", InstallError::Timeout),
        ] {
            let temp = Temp::new();
            let manager = manager(&temp);
            let c = catalog();
            let _lock = MutationLock::acquire(&manager.inner.roots).unwrap();
            let server = Server::new(fault);
            let m = c.rows()[0].manifest.clone().unwrap();
            let error = manager
                .run_install(
                    "fault",
                    &c,
                    &[m.clone()],
                    &AtomicBool::new(false),
                    None,
                    Some(&server.origin),
                )
                .unwrap_err();
            assert_eq!(error, expected, "{fault}");
            assert!(!manager
                .inner
                .roots
                .version(m.id, &m.version)
                .unwrap()
                .exists());
            assert!(manager.active_version(m.id).unwrap().is_none());
            let diagnostic = serde_json::to_string(&error).unwrap();
            assert!(!diagnostic.contains("secret"));
            assert!(!diagnostic.contains("evil"));
        }
    }
    #[test]
    fn async_job_cancel_generation_dedup_and_shutdown() {
        let temp = Temp::new();
        let manager = manager(&temp);
        let c = catalog();
        let lock = MutationLock::acquire(&manager.inner.roots).unwrap();
        manager.persist_catalog(&c).unwrap();
        let plan = manager
            .plan_verified("primary", request(ComponentId::Node), &c)
            .unwrap();
        let server = Server::new("slow");
        let status = manager
            .start_verified(
                "primary",
                Confirmation {
                    plan_id: plan.plan_id.clone(),
                    digest: plan.digest.clone(),
                    confirmed: true,
                },
                c,
                lock,
                None,
                Some(server.origin.clone()),
            )
            .unwrap();
        let duplicate = manager
            .install(
                "secondary",
                Confirmation {
                    plan_id: plan.plan_id,
                    digest: plan.digest,
                    confirmed: true,
                },
                None,
            )
            .unwrap();
        assert_eq!(duplicate.operation_id, status.operation_id);
        assert!(manager.list().is_ok());
        assert_eq!(
            manager
                .cancel("foreign", &status.operation_id, status.generation)
                .unwrap_err(),
            InstallError::Foreign
        );
        assert_eq!(
            manager
                .cancel("primary", &status.operation_id, status.generation + 1)
                .unwrap_err(),
            InstallError::Stale
        );
        manager
            .cancel("primary", &status.operation_id, status.generation)
            .unwrap();
        manager.shutdown();
        let final_status = manager.inner.jobs.lock().unwrap()[&status.operation_id]
            .status
            .clone();
        assert_eq!(
            final_status.state,
            JobState::Cancelled,
            "{:?}",
            final_status.error
        );
        let _lock = MutationLock::acquire(&manager.inner.roots).unwrap();
    }
    fn crafted_archive(temp: &Temp, path: &str, kind: tar::EntryType, body: &[u8]) -> PathBuf {
        let filename = temp.0.join(format!(
            "craft-{}.gz",
            GENERATION.fetch_add(1, Ordering::Relaxed)
        ));
        let encoder = flate2::write::GzEncoder::new(
            File::create(&filename).unwrap(),
            flate2::Compression::default(),
        );
        let mut archive = tar::Builder::new(encoder);
        let mut h = tar::Header::new_gnu();
        h.set_size(body.len() as u64);
        h.set_mode(0o777);
        h.set_entry_type(kind);
        // Raw name bytes deliberately avoid the builder's own safe path checks.
        h.as_mut_bytes()[..100].fill(0);
        h.as_mut_bytes()[..path.len()].copy_from_slice(path.as_bytes());
        h.set_cksum();
        archive.append(&h, body).unwrap();
        archive.into_inner().unwrap().finish().unwrap();
        filename
    }
    #[test]
    fn strict_archive_links_traversal_special_duplicates_target_and_hash() {
        let temp = Temp::new();
        let c = catalog();
        let m = c.rows()[0].manifest.clone().unwrap();
        for (path, kind) in [
            ("../escape", tar::EntryType::Regular),
            ("/escape", tar::EntryType::Regular),
            ("bin/node", tar::EntryType::Symlink),
            ("bin/node", tar::EntryType::Link),
            ("bin/node", tar::EntryType::Fifo),
            ("bin/node", tar::EntryType::Directory),
            ("bin/node", tar::EntryType::GNULongName),
        ] {
            let archive = crafted_archive(&temp, path, kind, b"x");
            let stage = temp.0.join(format!(
                "stage-{}",
                GENERATION.fetch_add(1, Ordering::Relaxed)
            ));
            private_dir(&stage).unwrap();
            assert!(extract(&archive, &stage, &m, &AtomicBool::new(false), true).is_err());
        }
        assert!(!temp.0.join("escape").exists());
        let archive_path = temp.0.join("valid.gz");
        fs::write(&archive_path, archive(&m)).unwrap();
        let stage = temp.0.join("target");
        private_dir(&stage).unwrap();
        assert_eq!(
            extract(&archive_path, &stage, &m, &AtomicBool::new(false), false),
            Err(InstallError::Target)
        );
        let stage = temp.0.join("hash");
        private_dir(&stage).unwrap();
        let mut m = m.clone();
        m.files[0].sha256 = "0".repeat(64);
        assert_eq!(
            extract(&archive_path, &stage, &m, &AtomicBool::new(false), true),
            Err(InstallError::Integrity)
        );
        let stage = temp.0.join("cancel");
        private_dir(&stage).unwrap();
        assert_eq!(
            extract(&archive_path, &stage, &m, &AtomicBool::new(true), true),
            Err(InstallError::Cancelled)
        );
    }
    #[test]
    fn bounded_ustar_record_padding_accepts_real_writer_and_rejects_extra_tail() {
        let temp = Temp::new();
        let m = catalog().rows()[0].manifest.clone().unwrap();
        let mut raw = Vec::new();
        flate2::read::GzDecoder::new(archive(&m).as_slice())
            .read_to_end(&mut raw)
            .unwrap();
        let end = raw.iter().rposition(|b| *b != 0).unwrap() + 1;
        raw.truncate((end + 511) / 512 * 512);
        for (name, padding, garbage, expected) in [
            ("record", 10240, false, Ok(())),
            ("oversized", 20480, false, Err(InstallError::UnsafeArchive)),
            ("garbage", 10240, true, Err(InstallError::UnsafeArchive)),
        ] {
            let mut bytes = raw.clone();
            bytes.resize(bytes.len() + padding, 0);
            if garbage {
                *bytes.last_mut().unwrap() = 1;
            }
            let mut gzip =
                flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
            gzip.write_all(&bytes).unwrap();
            let compressed = gzip.finish().unwrap();
            let path = temp.0.join(format!("{name}.gz"));
            fs::write(&path, &compressed).unwrap();
            let mut manifest = m.clone();
            manifest.archive.compressed_bytes = compressed.len() as u64;
            let stage = temp.0.join(name);
            private_dir(&stage).unwrap();
            assert_eq!(
                extract(&path, &stage, &manifest, &AtomicBool::new(false), true),
                expected
            );
        }
    }
    #[test]
    fn immutable_receipts_complete_hashes_and_private_symlink_rejection() {
        let (_temp, manager) = installed_manager(ComponentId::Node);
        let c = catalog();
        let m = c.rows()[0].manifest.as_ref().unwrap();
        let root = manager.ready(&c, m).unwrap();
        fs::write(root.join("extra"), b"secret-canary").unwrap();
        assert!(manager.ready(&c, m).is_err());
        fs::remove_file(root.join("extra")).unwrap();
        let target = root.join(&m.files[0].path);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).unwrap();
        }
        fs::write(&target, b"corrupt").unwrap();
        assert!(manager.ready(&c, m).is_err());
        #[cfg(unix)]
        {
            let outside = Temp::new();
            let alias = manager.inner.roots.software.join("escape");
            std::os::unix::fs::symlink(&outside.0, &alias).unwrap();
            assert_eq!(
                private_dir(&alias.join("nested")),
                Err(InstallError::Storage)
            );
            assert!(!outside.0.join("nested").exists());
        }
    }
    #[test]
    fn kernel_lock_stale_owner_runtime_lease_and_safe_diagnostics() {
        let (temp, manager) = installed_manager(ComponentId::Node);
        let lock = MutationLock::acquire(&manager.inner.roots).unwrap();
        assert!(matches!(
            MutationLock::acquire(&manager.inner.roots),
            Err(InstallError::Busy)
        ));
        drop(lock);
        assert!(MutationLock::acquire(&manager.inner.roots).is_ok());
        // Fixture trust is compile-gated; the public native resolver still performs complete rehash/compatibility.
        let lease = manager.acquire_runtime(ComponentId::Node).unwrap();
        assert_eq!(lease.manifest.id, ComponentId::Node);
        assert!(lease.root.join("bin/node").is_file());
        assert!(matches!(
            manager.remove(request(ComponentId::Node)),
            Err(InstallError::InUse)
        ));
        drop(lease);
        assert!(manager
            .exclusive_version(ComponentId::Node, "24.15.0")
            .is_ok());
        let snapshot = manager.diagnostics("primary").unwrap();
        let node = snapshot
            .components
            .iter()
            .find(|row| row.id == ComponentId::Node)
            .unwrap();
        assert_eq!(node.target, target());
        assert!(node.download_bytes.unwrap() > 0);
        assert!(node.installed_bytes.unwrap() > 0);
        assert!(node.dependencies.is_empty());
        let agent = snapshot
            .components
            .iter()
            .find(|row| row.id == ComponentId::Codex)
            .unwrap();
        assert_eq!(agent.dependencies.len(), 1);
        assert_eq!(agent.dependencies[0].id, ComponentId::Node);
        let diagnostic = serde_json::to_string(&snapshot).unwrap();
        assert!(!diagnostic.contains(temp.0.to_str().unwrap()));
        assert!(!diagnostic.contains("archive.url"));
        assert_eq!(
            manager
                .catalog(VerificationPurpose::NewInstall)
                .unwrap()
                .rows()
                .len(),
            5
        );
    }
    #[test]
    fn durable_interruption_snapshot_and_recovery_keeps_old_selection() {
        let (_temp, manager) = installed_manager(ComponentId::Node);
        let previous = manager.active_version(ComponentId::Node).unwrap();
        let status = JobStatus {
            operation_id: "interrupted".into(),
            generation: 123,
            sequence: 5,
            state: JobState::Activating,
            id: Some(ComponentId::Node),
            completed_bytes: 0,
            total_bytes: 0,
            error: None,
        };
        atomic_json(
            &manager.inner.roots.software.join("current-job.json"),
            &DurableJob {
                owner: "primary".into(),
                digest: "0".repeat(64),
                status,
            },
        )
        .unwrap();
        let stage = manager.inner.roots.staging().join("interrupted");
        private_dir(&stage).unwrap();
        fs::write(stage.join("partial"), b"partial").unwrap();
        atomic_json(&stage.join("owner.json"), &"interrupted").unwrap();
        manager.recover().unwrap();
        let diagnostic = manager.diagnostics("new-window").unwrap();
        assert_eq!(diagnostic.jobs[0].state, JobState::Failed);
        assert_eq!(diagnostic.jobs[0].error, Some(InstallError::Shutdown));
        assert_eq!(manager.active_version(ComponentId::Node).unwrap(), previous);
        assert!(!stage.exists());
        let path = manager.inner.roots.software.join("catalog-watermark.json");
        fs::write(&path, b"{}").unwrap();
        assert!(matches!(
            manager.catalog(VerificationPurpose::NewInstall),
            Err(InstallError::Catalog)
        ));
    }

    #[test]
    fn crash_boundaries_keep_old_ready_and_never_select_partial() {
        for boundary in 1..=5 {
            let (_temp, manager) = installed_manager(ComponentId::Node);
            let catalog = catalog();
            let old = manager.active_version(ComponentId::Node).unwrap();
            let m = catalog.rows()[1].manifest.clone().unwrap();
            let server = Server::new("");
            let lock = MutationLock::acquire(&manager.inner.roots).unwrap();
            manager
                .inner
                .fault_boundary
                .store(boundary, Ordering::Relaxed);
            assert_eq!(
                manager.run_install(
                    "crash",
                    &catalog,
                    &[m.clone()],
                    &AtomicBool::new(false),
                    None,
                    Some(&server.origin)
                ),
                Err(InstallError::Shutdown)
            );
            drop(lock);
            manager.inner.fault_boundary.store(0, Ordering::Relaxed);
            manager.recover().unwrap();
            assert_eq!(manager.active_version(ComponentId::Node).unwrap(), old);
            assert!(manager
                .ready(&catalog, catalog.rows()[0].manifest.as_ref().unwrap())
                .is_ok());
            if manager.active_version(m.id).unwrap().is_some() {
                assert!(manager.ready(&catalog, &m).is_ok());
            }
            if boundary < 4 {
                assert!(!manager
                    .inner
                    .roots
                    .version(m.id, &m.version)
                    .unwrap()
                    .exists());
            } else {
                assert!(manager.ready(&catalog, &m).is_ok());
            }
        }
    }
    #[test]
    fn cross_process_lock_child() {
        if let Ok(path) = std::env::var("SPECOPS_TEST_LOCK_ROOT") {
            let roots = ComponentRoots::new(Path::new(&path));
            let _lock = MutationLock::acquire(&roots).unwrap();
            fs::write(Path::new(&path).join("child-ready"), b"ready").unwrap();
            thread::sleep(Duration::from_secs(20));
        }
    }
    #[test]
    fn process_death_releases_lock_inode_without_stale_owner_guessing() {
        let temp = Temp::new();
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .arg("component_manager::tests::cross_process_lock_child")
            .arg("--exact")
            .env("SPECOPS_TEST_LOCK_ROOT", &temp.0)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let start = Instant::now();
        while !temp.0.join("child-ready").exists() && start.elapsed() < Duration::from_secs(5) {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(temp.0.join("child-ready").exists());
        let roots = ComponentRoots::new(&temp.0);
        assert!(matches!(
            MutationLock::acquire(&roots),
            Err(InstallError::Busy)
        ));
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(MutationLock::acquire(&roots).is_ok());
    }

    #[test]
    fn low_disk_and_explicit_retry_budget_prevent_unowned_jobs() {
        let temp = Temp::new();
        let manager = manager(&temp);
        let catalog = catalog();
        let plan = manager
            .plan_verified("primary", request(ComponentId::Node), &catalog)
            .unwrap();
        manager.inner.available_space.store(0, Ordering::Relaxed);
        let confirmation = || Confirmation {
            plan_id: plan.plan_id.clone(),
            digest: plan.digest.clone(),
            confirmed: true,
        };
        let lock = MutationLock::acquire(&manager.inner.roots).unwrap();
        assert!(matches!(
            manager.start_verified("primary", confirmation(), catalog, lock, None, None),
            Err(InstallError::LowDisk)
        ));
        assert!(manager.inner.jobs.lock().unwrap().is_empty());
        manager
            .inner
            .available_space
            .store(u64::MAX, Ordering::Relaxed);
        manager
            .inner
            .plans
            .lock()
            .unwrap()
            .get_mut(&plan.plan_id)
            .unwrap()
            .attempts = 4;
        let lock = MutationLock::acquire(&manager.inner.roots).unwrap();
        assert!(matches!(
            manager.start_verified("primary", confirmation(), self::catalog(), lock, None, None),
            Err(InstallError::Limit)
        ));
    }
    #[test]
    fn probe_pin_and_output_bounds_fail_closed() {
        let temp = Temp::new();
        let root = temp.0.join("probe");
        private_dir(&root.join("bin")).unwrap();
        let m = catalog().rows()[0].manifest.clone().unwrap();
        let executable = root.join("bin/node");
        for body in [
            "#!/bin/sh\nprintf 'wrong version\\n'\n",
            "#!/bin/sh\nprintf 'v24.15.0 '\n/usr/bin/yes x | /usr/bin/head -c 6000\n",
        ] {
            fs::write(&executable, body).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
            }
            assert_eq!(
                probe(&root, &m, &AtomicBool::new(false), false),
                Err(InstallError::Probe)
            );
        }
    }
}
