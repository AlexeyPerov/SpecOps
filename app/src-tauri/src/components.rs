//! Native component contracts. Parsing metadata never authorizes download or execution.
#![allow(dead_code)]
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

pub const MANIFEST_SCHEMA: u32 = 1;
pub const MAX_MANIFEST_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_FILES: usize = 20_000;
pub const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_UNPACKED_BYTES: u64 = 1536 * 1024 * 1024;
pub const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ComponentId {
    Node,
    Codex,
    Opencode,
    Claude,
    Cursor,
}
impl ComponentId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Node => "node",
            Self::Codex => "codex",
            Self::Opencode => "opencode",
            Self::Claude => "claude",
            Self::Cursor => "cursor",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Target {
    pub os: String,
    pub arch: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Compatibility {
    pub app_versions: Vec<String>,
    pub host_versions: Vec<String>,
    pub adapter_revision: String,
    pub native_store_revision: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Dependency {
    pub id: ComponentId,
    pub version: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
    pub executable: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Archive {
    pub format: ArchiveFormat,
    pub url: String,
    pub sha256: String,
    pub compressed_bytes: u64,
    pub unpacked_bytes: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ArchiveFormat {
    TarGz,
    Zip,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Signature {
    pub algorithm: SignatureAlgorithm,
    pub key_id: String,
    pub value: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SignatureAlgorithm {
    Ed25519,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeliveryStatus {
    Reviewed,
    Unavailable,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Distribution {
    pub status: DeliveryStatus,
    pub evidence_id: String,
    pub notice_paths: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ComponentManifest {
    pub schema_version: u32,
    pub id: ComponentId,
    pub version: String,
    pub target: Target,
    pub compatibility: Compatibility,
    pub archive: Archive,
    pub files: Vec<FileEntry>,
    pub entries: BTreeMap<String, String>,
    pub dependencies: Vec<Dependency>,
    pub distribution: Distribution,
    pub signature: Signature,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContractError {
    Schema,
    Target,
    InvalidMetadata,
    UnsafePath,
    Limit,
    Compatibility,
    Dependency,
    Unavailable,
    Receipt,
    InUse,
    NativeStore,
}
fn token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        && value != "."
        && value != ".."
}
pub fn safe_relative_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && !value.contains('\\')
        && !value.contains(':')
        && value.split('/').all(|part| {
            !part.is_empty()
                && part.len() <= 255
                && part != "."
                && part != ".."
                && !part.chars().any(|c| c.is_control())
        })
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
impl ComponentManifest {
    pub fn parse(bytes: &[u8]) -> Result<Self, ContractError> {
        if bytes.len() > MAX_MANIFEST_BYTES {
            return Err(ContractError::Limit);
        }
        let result: Self = serde_json::from_slice(bytes).map_err(|_| ContractError::Schema)?;
        result.validate()?;
        Ok(result)
    }
    pub fn validate(&self) -> Result<(), ContractError> {
        if self.schema_version != MANIFEST_SCHEMA {
            return Err(ContractError::Schema);
        }
        if self.target.os != "darwin" || self.target.arch != "arm64" {
            return Err(ContractError::Target);
        }
        let c = &self.compatibility;
        if !token(&self.version)
            || !token(&c.adapter_revision)
            || !token(&c.native_store_revision)
            || c.app_versions.is_empty()
            || c.host_versions.is_empty()
            || c.app_versions.len() > 16
            || c.host_versions.len() > 16
            || !c
                .app_versions
                .iter()
                .chain(&c.host_versions)
                .all(|v| token(v))
            || !token(&self.distribution.evidence_id)
            || !token(&self.signature.key_id)
            || self.signature.value.len() != 128
            || !self.signature.value.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(ContractError::InvalidMetadata);
        }
        // This is only a syntactic URL boundary. Catalog verification must pin the full URL.
        let url = &self.archive.url;
        if !url.starts_with("https://")
            || url.len() > 2048
            || url.bytes().any(|b| b <= 32 || b >= 127)
            || url.contains('@')
            || url.contains('#')
            || url.contains('?')
            || !digest(&self.archive.sha256)
        {
            return Err(ContractError::InvalidMetadata);
        }
        if self.files.is_empty()
            || self.files.len() > MAX_FILES
            || self.entries.is_empty()
            || self.entries.len() > 16
            || self.archive.compressed_bytes == 0
            || self.archive.compressed_bytes > MAX_ARCHIVE_BYTES
            || self.archive.unpacked_bytes == 0
            || self.archive.unpacked_bytes > MAX_UNPACKED_BYTES
        {
            return Err(ContractError::Limit);
        }
        let mut paths = BTreeMap::new();
        let mut folded = BTreeSet::new();
        let mut total = 0u64;
        for f in &self.files {
            if !safe_relative_path(&f.path) {
                return Err(ContractError::UnsafePath);
            }
            if f.bytes > MAX_FILE_BYTES
                || !digest(&f.sha256)
                || paths.insert(f.path.as_str(), f).is_some()
                || !folded.insert(f.path.to_lowercase())
            {
                return Err(ContractError::InvalidMetadata);
            }
            total = total.checked_add(f.bytes).ok_or(ContractError::Limit)?;
        }
        if total != self.archive.unpacked_bytes {
            return Err(ContractError::Limit);
        }
        for path in paths.keys() {
            let mut prefix = String::new();
            for part in path.split('/').take(path.split('/').count() - 1) {
                if !prefix.is_empty() {
                    prefix.push('/');
                }
                prefix.push_str(part);
                if folded.contains(&prefix.to_lowercase()) {
                    return Err(ContractError::UnsafePath);
                }
            }
        }
        if self
            .entries
            .iter()
            .any(|(name, path)| !token(name) || !paths.contains_key(path.as_str()))
            || self.distribution.notice_paths.is_empty()
            || self.distribution.notice_paths.len() > MAX_FILES
            || self
                .distribution
                .notice_paths
                .iter()
                .any(|path| !paths.contains_key(path.as_str()))
        {
            return Err(ContractError::InvalidMetadata);
        }
        let mut deps = BTreeSet::new();
        if self
            .dependencies
            .iter()
            .any(|d| d.id == self.id || !token(&d.version) || !deps.insert(d.id))
        {
            return Err(ContractError::Dependency);
        }
        if self.id == ComponentId::Node {
            if !self.dependencies.is_empty() {
                return Err(ContractError::Dependency);
            }
        } else if self.dependencies.len() != 1 || self.dependencies[0].id != ComponentId::Node {
            return Err(ContractError::Dependency);
        }
        Ok(())
    }
    pub fn compatible(&self, app: &str, host: &str, adapter: &str) -> Result<(), ContractError> {
        if !self.compatibility.app_versions.iter().any(|v| v == app)
            || !self.compatibility.host_versions.iter().any(|v| v == host)
            || self.compatibility.adapter_revision != adapter
        {
            return Err(ContractError::Compatibility);
        }
        Ok(())
    }
}
/// Caller supplies only manifests already authenticated against embedded catalog keys.
/// Validation itself is not a signature verifier and does not make an artifact trusted.
pub fn validate_plan(
    manifests: &[ComponentManifest],
    app: &str,
    host: &str,
    adapters: &BTreeMap<ComponentId, String>,
    allow_unavailable_fixture: bool,
) -> Result<(), ContractError> {
    if manifests.is_empty() || manifests.len() > 5 {
        return Err(ContractError::Limit);
    }
    let mut versions = BTreeMap::new();
    for m in manifests {
        m.validate()?;
        m.compatible(
            app,
            host,
            adapters.get(&m.id).ok_or(ContractError::Compatibility)?,
        )?;
        if !allow_unavailable_fixture && m.distribution.status != DeliveryStatus::Reviewed {
            return Err(ContractError::Unavailable);
        }
        if versions.insert(m.id, m.version.as_str()).is_some() {
            return Err(ContractError::Dependency);
        }
    }
    for m in manifests {
        if m.dependencies
            .iter()
            .any(|d| versions.get(&d.id).copied() != Some(d.version.as_str()))
        {
            return Err(ContractError::Dependency);
        }
    }
    Ok(())
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ComponentState {
    Missing,
    Installing,
    Verifying,
    Installed,
    UpdateAvailable,
    InUse,
    Failed,
    Incompatible,
    Unsupported,
    Unavailable,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AccountState {
    Unknown,
    SignedOut,
    Authenticated,
    NotEntitled,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeHealth {
    Unknown,
    Healthy,
    Offline,
    Failed,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ComponentEvent {
    pub operation_id: String,
    pub sequence: u64,
    pub id: ComponentId,
    pub state: ComponentState,
    pub completed_bytes: u64,
    pub total_bytes: u64,
}
impl ComponentEvent {
    pub fn validate(&self) -> Result<(), ContractError> {
        if !token(&self.operation_id)
            || self.sequence == 0
            || self.completed_bytes > self.total_bytes
            || self.total_bytes > MAX_UNPACKED_BYTES
        {
            return Err(ContractError::Limit);
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InstallReceipt {
    pub schema_version: u32,
    pub id: ComponentId,
    pub version: String,
    pub target: Target,
    pub manifest_sha256: String,
    pub catalog_revision: String,
}
impl InstallReceipt {
    /// Receipt is usable only after catalog authentication AND rechecking installed file hashes.
    pub fn validate(
        &self,
        manifest: &ComponentManifest,
        manifest_sha256: &str,
        catalog_revision: &str,
    ) -> Result<(), ContractError> {
        manifest.validate()?;
        if self.schema_version != MANIFEST_SCHEMA
            || self.id != manifest.id
            || self.version != manifest.version
            || self.target != manifest.target
            || !digest(&self.manifest_sha256)
            || self.manifest_sha256 != manifest_sha256
            || !token(&self.catalog_revision)
            || self.catalog_revision != catalog_revision
        {
            return Err(ContractError::Receipt);
        }
        Ok(())
    }
}
#[derive(Debug, Clone)]
pub struct ComponentRoots {
    pub software: PathBuf,
    pub private: PathBuf,
}
impl ComponentRoots {
    pub fn new(app_data: &Path) -> Self {
        Self {
            software: app_data.join("components"),
            private: app_data.join("agent-private"),
        }
    }
    pub fn version(&self, id: ComponentId, version: &str) -> Result<PathBuf, ContractError> {
        if !token(version) {
            return Err(ContractError::UnsafePath);
        }
        Ok(self
            .software
            .join("versions")
            .join(id.as_str())
            .join(version)
            .join("darwin-arm64"))
    }
    pub fn staging(&self) -> PathBuf {
        self.software.join("staging")
    }
    pub fn cache(&self) -> PathBuf {
        self.software.join("cache")
    }
    pub fn receipts(&self) -> PathBuf {
        self.software.join("receipts")
    }
    pub fn active(&self) -> PathBuf {
        self.software.join("active")
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComponentLease {
    pub id: ComponentId,
    pub version: String,
    pub owner: String,
}
pub fn removal_allowed(
    id: ComponentId,
    version: &str,
    leases: &[ComponentLease],
    dependents: &[ComponentManifest],
) -> Result<(), ContractError> {
    if leases.iter().any(|l| l.id == id && l.version == version)
        || dependents.iter().any(|m| {
            m.dependencies
                .iter()
                .any(|d| d.id == id && d.version == version)
        })
    {
        return Err(ContractError::InUse);
    }
    Ok(())
}
pub fn rollback_allowed(
    current: &ComponentManifest,
    candidate: &ComponentManifest,
    native_store_revision: &str,
    leases: &[ComponentLease],
) -> Result<(), ContractError> {
    if current.id != candidate.id || current.target != candidate.target {
        return Err(ContractError::Compatibility);
    }
    removal_allowed(current.id, &current.version, leases, &[])?;
    if candidate.compatibility.native_store_revision != native_store_revision {
        return Err(ContractError::NativeStore);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixtures() -> Vec<ComponentManifest> {
        serde_json::from_str::<Vec<ComponentManifest>>(include_str!(
            "../fixtures/components/manifests.json"
        ))
        .unwrap()
    }
    fn adapters(ms: &[ComponentManifest]) -> BTreeMap<ComponentId, String> {
        ms.iter()
            .map(|m| (m.id, m.compatibility.adapter_revision.clone()))
            .collect()
    }
    #[test]
    fn five_complete_contract_fixtures() {
        let ms = fixtures();
        assert_eq!(ms.len(), 5);
        for m in &ms {
            ComponentManifest::parse(&serde_json::to_vec(m).unwrap()).unwrap();
        }
        validate_plan(&ms, "0.3.0", "0.1.0", &adapters(&ms), true).unwrap();
        assert_eq!(
            validate_plan(&ms, "0.3.0", "0.1.0", &adapters(&ms), false),
            Err(ContractError::Unavailable)
        );
    }
    #[test]
    fn strict_schema_and_target() {
        let mut value = serde_json::to_value(&fixtures()[0]).unwrap();
        value["unknownRequired"] = true.into();
        assert_eq!(
            ComponentManifest::parse(&serde_json::to_vec(&value).unwrap()).unwrap_err(),
            ContractError::Schema
        );
        let mut m = fixtures().remove(0);
        m.schema_version = 2;
        assert_eq!(m.validate(), Err(ContractError::Schema));
        m.schema_version = 1;
        m.target.arch = "x64".into();
        assert_eq!(m.validate(), Err(ContractError::Target));
        assert_eq!(
            ComponentManifest::parse(&vec![b' '; MAX_MANIFEST_BYTES + 1]).unwrap_err(),
            ContractError::Limit
        );
    }
    #[test]
    fn traversal_collision_and_archive_limits() {
        for path in [
            "node_modules/@cursor/sdk/dist/986.js",
            "node_modules/@scope/pkg/a+b.js",
            "assets/Local settings/данные.json",
        ] {
            assert!(safe_relative_path(path));
        }
        for path in ["../node", "/node", "C:/node", "a\\b", "a//b", "a/./b"] {
            let mut m = fixtures().remove(0);
            m.files[0].path = path.into();
            assert_eq!(m.validate(), Err(ContractError::UnsafePath));
        }
        let mut m = fixtures().remove(0);
        m.files.push(m.files[0].clone());
        assert!(m.validate().is_err());
        let mut m = fixtures().remove(0);
        let mut collision = m.files[0].clone();
        collision.path = collision.path.to_uppercase();
        m.files.push(collision);
        assert_eq!(m.validate(), Err(ContractError::InvalidMetadata));
        let mut m = fixtures().remove(0);
        let mut prefix = m.files[0].clone();
        prefix.path = "bin".into();
        m.files.push(prefix);
        m.archive.unpacked_bytes += 1;
        assert_eq!(m.validate(), Err(ContractError::UnsafePath));
        let mut m = fixtures().remove(0);
        m.archive.unpacked_bytes += 1;
        assert_eq!(m.validate(), Err(ContractError::Limit));
        let mut m = fixtures().remove(0);
        m.archive.compressed_bytes = MAX_ARCHIVE_BYTES + 1;
        assert_eq!(m.validate(), Err(ContractError::Limit));
        let mut m = fixtures().remove(0);
        m.archive.url = "https://user:secret@example.test/node".into();
        assert_eq!(m.validate(), Err(ContractError::InvalidMetadata));
        let mut m = fixtures().remove(0);
        m.files[0].sha256 = "bad".into();
        assert!(m.validate().is_err());
    }
    #[test]
    fn exact_versions_and_dependency_rejection() {
        let mut ms = fixtures();
        assert_eq!(
            validate_plan(&ms, "0.4.0", "0.1.0", &adapters(&ms), true),
            Err(ContractError::Compatibility)
        );
        ms[1].dependencies[0].version = "latest".into();
        assert_eq!(
            validate_plan(&ms, "0.3.0", "0.1.0", &adapters(&ms), true),
            Err(ContractError::Dependency)
        );
        let mut m = fixtures().remove(1);
        m.dependencies.push(m.dependencies[0].clone());
        assert_eq!(m.validate(), Err(ContractError::Dependency));
    }
    #[test]
    fn receipts_and_private_storage_separation() {
        let m = fixtures().remove(0);
        let mut r = InstallReceipt {
            schema_version: 1,
            id: m.id,
            version: m.version.clone(),
            target: m.target.clone(),
            manifest_sha256: "a".repeat(64),
            catalog_revision: "fixture-1".into(),
        };
        r.validate(&m, &"a".repeat(64), "fixture-1").unwrap();
        r.version = "latest".into();
        assert_eq!(
            r.validate(&m, &"a".repeat(64), "fixture-1"),
            Err(ContractError::Receipt)
        );
        let roots = ComponentRoots::new(Path::new("/private/app"));
        for path in [
            roots.version(m.id, &m.version).unwrap(),
            roots.cache(),
            roots.staging(),
            roots.receipts(),
            roots.active(),
        ] {
            assert!(!path.starts_with(&roots.private));
        }
        assert!(roots.version(m.id, "../accounts").is_err());
    }
    #[test]
    fn leases_dependents_and_native_store_rollback() {
        let ms = fixtures();
        assert_eq!(
            removal_allowed(ms[0].id, &ms[0].version, &[], &ms[1..]),
            Err(ContractError::InUse)
        );
        let lease = ComponentLease {
            id: ms[1].id,
            version: ms[1].version.clone(),
            owner: "worker-1".into(),
        };
        assert_eq!(
            removal_allowed(ms[1].id, &ms[1].version, &[lease], &[]),
            Err(ContractError::InUse)
        );
        assert_eq!(
            rollback_allowed(&ms[1], &ms[1], "unknown-store", &[]),
            Err(ContractError::NativeStore)
        );
        rollback_allowed(
            &ms[1],
            &ms[1],
            &ms[1].compatibility.native_store_revision,
            &[],
        )
        .unwrap();
    }
    #[test]
    fn bounded_events_cannot_include_raw_errors_or_credentials() {
        let mut e = ComponentEvent {
            operation_id: "install-1".into(),
            sequence: 1,
            id: ComponentId::Node,
            state: ComponentState::Verifying,
            completed_bytes: 1,
            total_bytes: 2,
        };
        e.validate().unwrap();
        e.completed_bytes = 3;
        assert_eq!(e.validate(), Err(ContractError::Limit));
        let mut value = serde_json::to_value(&e).unwrap();
        value["rawError"] = "secret".into();
        assert!(serde_json::from_value::<ComponentEvent>(value).is_err());
    }
}
