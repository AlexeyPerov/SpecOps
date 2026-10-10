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
    fs::{self, File, OpenOptions},
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
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub catalog_revision: u64,
    pub target: Target,
    pub components: Vec<InventoryRow>,
    pub jobs: Vec<JobStatus>,
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
        let file = io(OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path))?;
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
fn private_dir(path: &Path) -> Result<()> {
    safe_ancestors(path)?;
    if let Ok(meta) = fs::symlink_metadata(path) {
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err(InstallError::Storage);
        }
    }
    io(fs::create_dir_all(path))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        io(fs::set_permissions(path, fs::Permissions::from_mode(0o700)))?;
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
fn bounded_read(path: &Path, limit: u64) -> Result<Vec<u8>> {
    safe_ancestors(path.parent().ok_or(InstallError::Storage)?)?;
    regular_or_missing(path)?;
    let file = io(File::open(path))?;
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
    io(io(File::open(path))?.sync_all())
}
fn atomic_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let parent = path.parent().ok_or(InstallError::Storage)?;
    private_dir(parent)?;
    regular_or_missing(path)?;
    let temporary = path.with_extension("pending");
    regular_or_missing(&temporary)?;
    let mut f = io(OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&temporary))?;
    io(f.write_all(&serde_json::to_vec(value).map_err(|_| InstallError::Storage)?))?;
    io(f.sync_all())?;
    io(fs::rename(&temporary, path))?;
    sync_dir(parent)
}
/// A runtime must hold this lease until its process tree has exited. Acquisition rehashes all files.
/// Native paths are crate-internal; they never appear in component diagnostics or frontend events.
pub struct RuntimeLease {
    pub root: PathBuf,
    pub manifest: ComponentManifest,
    _lock: File,
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
        io(OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path))
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
            root,
            manifest,
            _lock: file,
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
        let path = self.inner.roots.software.join("catalog-watermark.json");
        let highest: Option<CatalogWatermark> = if path.exists() {
            Some(
                serde_json::from_slice(&bounded_read(&path, 4096)?)
                    .map_err(|_| InstallError::Catalog)?,
            )
        } else {
            None
        };
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
                let state = if !supported() {
                    ComponentState::Unsupported
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
        let download_bytes = manifests.iter().map(|m| m.archive.compressed_bytes).sum();
        let required_disk_bytes = manifests
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
                extract(&archive, &content, m, cancel, fixture_endpoint.is_some())?;
                validate_inventory(&content, m, cancel)?;
                probe(&content, m, cancel, fixture_endpoint.is_some())?;
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
                    io(fs::set_permissions(
                        content.join("receipt.json"),
                        fs::Permissions::from_mode(0o400),
                    ))?;
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
                    io(fs::remove_dir_all(&destination))?;
                    sync_dir(parent)?;
                }
                self.emit(operation, JobState::Activating, Some(m.id), 0, 0, None, app);
                check(cancel)?;
                io(fs::rename(&content, &destination))?;
                sync_dir(parent)?;
                self.checkpoint(4)?;
            }
            self.ready(catalog, m)?;
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
        Ok(())
    }
    fn recover_locked(&self) -> Result<()> {
        // Staging/cache never count as installed. OS lock guarantees no living owner can be using these.
        for root in [self.inner.roots.staging(), self.inner.roots.cache()] {
            if root.exists() {
                private_dir(&root)?;
                for entry in io(fs::read_dir(&root))? {
                    let p = io(entry)?.path();
                    let meta = io(fs::symlink_metadata(&p))?;
                    if meta.is_dir() && !meta.file_type().is_symlink() {
                        io(fs::remove_dir_all(p))?;
                    } else {
                        io(fs::remove_file(p))?;
                    }
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
        if self.active_version(request.id)?.as_deref() == Some(request.version.as_str()) {
            let active = self
                .inner
                .roots
                .active()
                .join(format!("{}.json", request.id.as_str()));
            io(fs::remove_file(active))?;
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
            io(fs::remove_dir_all(&path))?;
            sync_dir(path.parent().unwrap())?;
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
    let mut file = io(OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(destination))?;
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
    let file = io(File::open(archive))?;
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
        let mut output = io(OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&file_path))?;
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
        if padding > 8192 || tail[..n].iter().any(|b| *b != 0) {
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
        let mut file = io(File::open(&path))?;
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
mod tests {
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
    struct Temp(PathBuf);
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
                        Ok((mut stream, _)) => serve(&mut stream, &fault),
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
    fn installed_manager(id: ComponentId) -> (Temp, ComponentManager) {
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
        let diagnostic = serde_json::to_string(&manager.diagnostics("primary").unwrap()).unwrap();
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
