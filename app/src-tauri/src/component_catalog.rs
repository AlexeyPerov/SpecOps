//! Authenticated catalog boundary shared by native installation and launch authorization.
#![allow(dead_code)]
use crate::components::{ComponentId, ComponentManifest, Signature, Target, MAX_ARCHIVE_BYTES};
use ed25519_dalek::{Signature as EdSignature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

pub const MAX_CATALOG_BYTES: usize = 16 * 1024 * 1024;
const CATALOG_DOMAIN: &[u8] = b"SpecOps component catalog v1\0";
const MANIFEST_DOMAIN: &[u8] = b"SpecOps component manifest v1\0";
const MAX_LIFETIME: u64 = 31 * 24 * 3600;
const EMBEDDED: &[u8] = include_bytes!("../resources/components/catalog.json");
const TRUST: &str = include_str!("../resources/components/trust.json");

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrustError {
    Limit,
    Schema,
    Signature,
    Expired,
    Replay,
    Identity,
    Endpoint,
    Unavailable,
    Revoked,
    Artifact,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Envelope {
    payload_hex: String,
    signature: Signature,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PublicKey {
    key_id: String,
    public_key: String,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct AuthorizedKey {
    key_id: String,
    public_key: String,
    minimum_revision: u64,
    maximum_revision: Option<u64>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrustRoots {
    keys: Vec<AuthorizedKey>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Availability {
    Available,
    Unavailable,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CatalogRow {
    pub id: ComponentId,
    pub version: String,
    pub target: Target,
    pub availability: Availability,
    pub reason: String,
    pub manifest: Option<ComponentManifest>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Revocation {
    pub id: ComponentId,
    pub version: String,
    pub target: Target,
    pub reason: String,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Catalog {
    schema_version: u32,
    revision: u64,
    issued_at: u64,
    expires_at: u64,
    rows: Vec<CatalogRow>,
    revoked: Vec<Revocation>,
}
/// Persist atomically only after authentication; same revision must bind identical bytes.
/// Never reset this watermark on metadata expiry or when choosing an embedded fallback.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CatalogWatermark {
    pub revision: u64,
    pub payload_sha256: String,
}
#[derive(Debug, Clone, Copy)]
pub enum VerificationPurpose {
    /// Fresh metadata required for first install, update and choosing any new artifact.
    NewInstall,
    /// Old authenticated metadata may revalidate the same installed receipt offline.
    InstalledReceipt,
}
/// Constructor is private: caller cannot supply a trust key or fixture policy in a release.
pub struct TrustPolicy {
    keys: Vec<AuthorizedKey>,
    origin: Option<&'static str>,
}
impl TrustPolicy {
    pub fn embedded() -> Result<Self, TrustError> {
        let roots: TrustRoots = serde_json::from_str(TRUST).map_err(|_| TrustError::Schema)?;
        Self::roots(roots.keys, None)
    }
    fn roots(keys: Vec<AuthorizedKey>, origin: Option<&'static str>) -> Result<Self, TrustError> {
        let mut identities = BTreeSet::new();
        if keys.is_empty() || keys.len() > 4 {
            return Err(TrustError::Limit);
        }
        for key in &keys {
            if !identifier(&key.key_id)
                || !identities.insert(&key.key_id)
                || key.minimum_revision == 0
                || key
                    .maximum_revision
                    .is_some_and(|v| v < key.minimum_revision)
                || decode_hex(&key.public_key)?.len() != 32
            {
                return Err(TrustError::Schema);
            }
        }
        Ok(Self { keys, origin })
    }
    #[cfg(test)]
    pub(crate) fn fixture() -> Self {
        let key: PublicKey = serde_json::from_str(include_str!(
            "../fixtures/components/distribution/trust.json"
        ))
        .unwrap();
        Self::roots(
            vec![AuthorizedKey {
                key_id: key.key_id,
                public_key: key.public_key,
                minimum_revision: 1,
                maximum_revision: None,
            }],
            Some("https://fixtures.invalid/v1/"),
        )
        .unwrap()
    }
    /// The application release owns this exact immutable endpoint. Signed payloads and
    /// archives cannot nominate catalog origins or add signing keys.
    pub fn catalog_endpoint(&self) -> Option<&'static str> {
        self.origin.map(|origin| {
            if origin == "https://fixtures.invalid/v1/" {
                "https://fixtures.invalid/v1/catalog.json"
            } else {
                origin
            }
        })
    }
    fn catalog_key(&self, id: &str, revision: u64) -> Result<(), TrustError> {
        let key = self
            .keys
            .iter()
            .find(|key| key.key_id == id)
            .ok_or(TrustError::Signature)?;
        if revision < key.minimum_revision || key.maximum_revision.is_some_and(|max| revision > max)
        {
            return Err(TrustError::Signature);
        }
        Ok(())
    }
    fn signature(
        &self,
        signature: &Signature,
        domain: &[u8],
        payload: &[u8],
    ) -> Result<(), TrustError> {
        let trusted = self
            .keys
            .iter()
            .find(|key| key.key_id == signature.key_id)
            .ok_or(TrustError::Signature)?;
        let key: [u8; 32] = decode_hex(&trusted.public_key)?
            .try_into()
            .map_err(|_| TrustError::Signature)?;
        let signature_bytes: [u8; 64] = decode_hex(&signature.value)?
            .try_into()
            .map_err(|_| TrustError::Signature)?;
        let key = VerifyingKey::from_bytes(&key).map_err(|_| TrustError::Signature)?;
        let mut message = domain.to_vec();
        message.extend_from_slice(payload);
        key.verify_strict(&message, &EdSignature::from_bytes(&signature_bytes))
            .map_err(|_| TrustError::Signature)
    }
    fn endpoint(&self, manifest: &ComponentManifest) -> Result<(), TrustError> {
        let origin = self.origin.ok_or(TrustError::Endpoint)?;
        let expected = format!(
            "{}{}-{}-darwin-arm64.tar.gz",
            origin,
            manifest.id.as_str(),
            manifest.version
        );
        if manifest.archive.url != expected {
            return Err(TrustError::Endpoint);
        }
        Ok(())
    }
}
fn decode_hex(value: &str) -> Result<Vec<u8>, TrustError> {
    if value.len() % 2 != 0
        || !value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err(TrustError::Signature);
    }
    (0..value.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&value[i..i + 2], 16).map_err(|_| TrustError::Signature))
        .collect()
}
pub fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn identifier(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s != "."
        && s != ".."
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
}
fn target(target: &Target) -> Result<(), TrustError> {
    if target.os == "darwin" && target.arch == "arm64" {
        Ok(())
    } else {
        Err(TrustError::Identity)
    }
}
fn bounded_reason(reason: &str) -> bool {
    !reason.is_empty() && reason.len() <= 256 && !reason.chars().any(char::is_control)
}
/// Holds only authenticated bytes/manifest bindings. It cannot be constructed by parsing JSON.
pub struct VerifiedCatalog {
    catalog: Catalog,
    watermark: CatalogWatermark,
    fresh: bool,
}
impl VerifiedCatalog {
    pub fn embedded(
        now: u64,
        purpose: VerificationPurpose,
        highest: Option<&CatalogWatermark>,
    ) -> Result<Self, TrustError> {
        Self::verify(EMBEDDED, &TrustPolicy::embedded()?, now, purpose, highest)
    }
    pub fn verify(
        bytes: &[u8],
        policy: &TrustPolicy,
        now: u64,
        purpose: VerificationPurpose,
        highest: Option<&CatalogWatermark>,
    ) -> Result<Self, TrustError> {
        if bytes.len() > MAX_CATALOG_BYTES * 2 + 1024 {
            return Err(TrustError::Limit);
        }
        let envelope: Envelope = serde_json::from_slice(bytes).map_err(|_| TrustError::Schema)?;
        if envelope.payload_hex.len() > MAX_CATALOG_BYTES * 2 {
            return Err(TrustError::Limit);
        }
        let payload = decode_hex(&envelope.payload_hex)?;
        policy.signature(&envelope.signature, CATALOG_DOMAIN, &payload)?;
        let catalog: Catalog = serde_json::from_slice(&payload).map_err(|_| TrustError::Schema)?;
        if catalog.schema_version != 1
            || catalog.revision == 0
            || catalog.rows.len() > 80
            || catalog.revoked.len() > 2000
            || catalog.expires_at <= catalog.issued_at
            || catalog.expires_at - catalog.issued_at > MAX_LIFETIME
        {
            return Err(TrustError::Schema);
        }
        policy.catalog_key(&envelope.signature.key_id, catalog.revision)?;
        let watermark = CatalogWatermark {
            revision: catalog.revision,
            payload_sha256: sha256(&payload),
        };
        if let Some(highest) = highest {
            if catalog.revision < highest.revision
                || (catalog.revision == highest.revision
                    && watermark.payload_sha256 != highest.payload_sha256)
            {
                return Err(TrustError::Replay);
            }
        }
        let fresh = now >= catalog.issued_at && now < catalog.expires_at;
        if !fresh && matches!(purpose, VerificationPurpose::NewInstall) {
            return Err(TrustError::Expired);
        }
        // A future catalog is never acceptable even as an offline receipt reference.
        if now < catalog.issued_at {
            return Err(TrustError::Expired);
        }
        let mut identities = BTreeSet::new();
        for row in &catalog.rows {
            target(&row.target)?;
            if !identifier(&row.version)
                || !bounded_reason(&row.reason)
                || !identities.insert((
                    row.id,
                    row.version.as_str(),
                    row.target.os.as_str(),
                    row.target.arch.as_str(),
                ))
            {
                return Err(TrustError::Identity);
            }
            match (&row.availability, &row.manifest) {
                (Availability::Unavailable, None) => {}
                (Availability::Available, Some(manifest)) => {
                    manifest.validate().map_err(|_| TrustError::Schema)?;
                    if manifest.id != row.id
                        || manifest.version != row.version
                        || manifest.target != row.target
                    {
                        return Err(TrustError::Identity);
                    }
                    if manifest.distribution.status != crate::components::DeliveryStatus::Reviewed {
                        return Err(TrustError::Unavailable);
                    }
                    // serde_json's ordered maps match sorted compact UTF-8 JSON from CI signer.
                    let mut unsigned =
                        serde_json::to_value(manifest).map_err(|_| TrustError::Schema)?;
                    unsigned
                        .as_object_mut()
                        .ok_or(TrustError::Schema)?
                        .remove("signature");
                    policy.signature(
                        &manifest.signature,
                        MANIFEST_DOMAIN,
                        &serde_json::to_vec(&unsigned).map_err(|_| TrustError::Schema)?,
                    )?;
                    policy.endpoint(manifest)?;
                }
                _ => return Err(TrustError::Schema),
            }
        }
        let mut revocations = BTreeSet::new();
        for revoked in &catalog.revoked {
            target(&revoked.target)?;
            if !identifier(&revoked.version)
                || !bounded_reason(&revoked.reason)
                || !revocations.insert((
                    revoked.id,
                    &revoked.version,
                    &revoked.target.os,
                    &revoked.target.arch,
                ))
            {
                return Err(TrustError::Identity);
            }
        }
        Ok(Self {
            catalog,
            watermark,
            fresh,
        })
    }
    pub fn watermark(&self) -> &CatalogWatermark {
        &self.watermark
    }
    pub fn rows(&self) -> &[CatalogRow] {
        &self.catalog.rows
    }
    pub fn revocations(&self) -> &[Revocation] {
        &self.catalog.revoked
    }
    pub fn revoked(&self, id: ComponentId, version: &str, requested_target: &Target) -> bool {
        self.catalog
            .revoked
            .iter()
            .any(|r| r.id == id && r.version == version && r.target == *requested_target)
    }
    /// Blocks both installs and new launches of revoked software, without mutating private data.
    pub fn installed_manifest(
        &self,
        id: ComponentId,
        version: &str,
        requested_target: &Target,
    ) -> Result<&ComponentManifest, TrustError> {
        if self.revoked(id, version, requested_target) {
            return Err(TrustError::Revoked);
        }
        self.catalog
            .rows
            .iter()
            .find(|r| r.id == id && r.version == version && r.target == *requested_target)
            .and_then(|r| r.manifest.as_ref())
            .ok_or(TrustError::Unavailable)
    }
    pub fn install_manifest(
        &self,
        id: ComponentId,
        version: &str,
        requested_target: &Target,
    ) -> Result<&ComponentManifest, TrustError> {
        if !self.fresh {
            return Err(TrustError::Expired);
        }
        self.installed_manifest(id, version, requested_target)
    }
    /// Caller also validates exact app/host/adapter/dependency plan using the A contracts.
    pub fn manifest_identity(manifest: &ComponentManifest) -> Result<String, TrustError> {
        let value = serde_json::to_value(manifest).map_err(|_| TrustError::Schema)?;
        Ok(sha256(
            &serde_json::to_vec(&value).map_err(|_| TrustError::Schema)?,
        ))
    }
    pub fn verify_artifact(manifest: &ComponentManifest, bytes: &[u8]) -> Result<(), TrustError> {
        if bytes.len() as u64 > MAX_ARCHIVE_BYTES
            || bytes.len() as u64 != manifest.archive.compressed_bytes
            || sha256(bytes) != manifest.archive.sha256
        {
            Err(TrustError::Artifact)
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    fn now() -> u64 {
        1791709200
    }
    fn bytes() -> Vec<u8> {
        include_bytes!("../fixtures/components/distribution/catalog.json").to_vec()
    }
    fn verify(
        bytes: &[u8],
        now: u64,
        purpose: VerificationPurpose,
        highest: Option<&CatalogWatermark>,
    ) -> Result<VerifiedCatalog, TrustError> {
        VerifiedCatalog::verify(bytes, &TrustPolicy::fixture(), now, purpose, highest)
    }
    fn signed_mutation(mutator: impl FnOnce(&mut serde_json::Value)) -> Vec<u8> {
        let mut envelope: serde_json::Value = serde_json::from_slice(&bytes()).unwrap();
        let mut payload: serde_json::Value =
            serde_json::from_slice(&decode_hex(envelope["payloadHex"].as_str().unwrap()).unwrap())
                .unwrap();
        mutator(&mut payload);
        let payload = serde_json::to_vec(&payload).unwrap();
        let seed: [u8; 32] =
            decode_hex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
                .unwrap()
                .try_into()
                .unwrap();
        let mut message = CATALOG_DOMAIN.to_vec();
        message.extend(&payload);
        let signature = SigningKey::from_bytes(&seed).sign(&message);
        envelope["payloadHex"] = payload
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect::<String>()
            .into();
        envelope["signature"]["value"] = signature
            .to_bytes()
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect::<String>()
            .into();
        serde_json::to_vec(&envelope).unwrap()
    }
    #[test]
    fn reviewed_key_overlap_rotates_catalog_signer_and_preserves_retained_manifest_verification() {
        let old = TrustPolicy::fixture().keys.remove(0);
        let next_signer = SigningKey::from_bytes(&[73; 32]);
        let next_public = next_signer
            .verifying_key()
            .to_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        let overlap = TrustPolicy::roots(
            vec![
                AuthorizedKey {
                    maximum_revision: Some(2),
                    ..old
                },
                AuthorizedKey {
                    key_id: "fixture-next".into(),
                    public_key: next_public,
                    minimum_revision: 3,
                    maximum_revision: None,
                },
            ],
            Some("https://fixtures.invalid/v1/"),
        )
        .unwrap();
        let unsigned = signed_mutation(|p| p["revision"] = 3.into());
        let mut envelope: serde_json::Value = serde_json::from_slice(&unsigned).unwrap();
        let payload = decode_hex(envelope["payloadHex"].as_str().unwrap()).unwrap();
        let mut message = CATALOG_DOMAIN.to_vec();
        message.extend(&payload);
        envelope["signature"]["keyId"] = "fixture-next".into();
        envelope["signature"]["value"] = next_signer
            .sign(&message)
            .to_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
            .into();
        let rotated = serde_json::to_vec(&envelope).unwrap();
        let old_catalog = VerifiedCatalog::verify(
            &bytes(),
            &overlap,
            now(),
            VerificationPurpose::InstalledReceipt,
            None,
        )
        .unwrap();
        let current = VerifiedCatalog::verify(
            &rotated,
            &overlap,
            now(),
            VerificationPurpose::NewInstall,
            Some(old_catalog.watermark()),
        )
        .unwrap();
        assert_eq!(current.rows().len(), 5); // Manifests still carry the approved old key.
        assert!(matches!(
            VerifiedCatalog::verify(
                &unsigned,
                &overlap,
                now(),
                VerificationPurpose::NewInstall,
                None
            ),
            Err(TrustError::Signature)
        ));
        assert!(matches!(
            VerifiedCatalog::verify(
                &rotated,
                &TrustPolicy::fixture(),
                now(),
                VerificationPurpose::NewInstall,
                None
            ),
            Err(TrustError::Signature)
        ));
        assert!(matches!(
            VerifiedCatalog::verify(
                &bytes(),
                &overlap,
                now(),
                VerificationPurpose::InstalledReceipt,
                Some(current.watermark())
            ),
            Err(TrustError::Replay)
        ));
        assert!(matches!(
            TrustPolicy::roots(vec![], None),
            Err(TrustError::Limit)
        ));
    }
    #[test]
    fn native_authentication_all_five_and_production_is_unavailable() {
        let catalog = verify(&bytes(), now(), VerificationPurpose::NewInstall, None).unwrap();
        assert_eq!(catalog.rows().len(), 5);
        let production =
            VerifiedCatalog::embedded(now(), VerificationPurpose::NewInstall, None).unwrap();
        assert!(production
            .rows()
            .iter()
            .all(|r| r.availability == Availability::Unavailable && r.manifest.is_none()));
        assert!(matches!(
            VerifiedCatalog::verify(
                &bytes(),
                &TrustPolicy::embedded().unwrap(),
                now(),
                VerificationPurpose::NewInstall,
                None
            ),
            Err(TrustError::Signature)
        ));
    }
    #[test]
    fn tampering_unknown_key_manifest_identity_and_endpoint_fail() {
        let mut value: serde_json::Value = serde_json::from_slice(&bytes()).unwrap();
        value["signature"]["keyId"] = "unauthorized".into();
        assert!(matches!(
            verify(
                &serde_json::to_vec(&value).unwrap(),
                now(),
                VerificationPurpose::NewInstall,
                None
            ),
            Err(TrustError::Signature)
        ));
        value["signature"]["keyId"] = "fixture-v1".into();
        value["signature"]["value"] = "0".repeat(128).into();
        assert!(matches!(
            verify(
                &serde_json::to_vec(&value).unwrap(),
                now(),
                VerificationPurpose::NewInstall,
                None
            ),
            Err(TrustError::Signature)
        ));
        let bad = signed_mutation(|p| {
            p["rows"][0]["manifest"]["files"][0]["sha256"] = "a".repeat(64).into();
        });
        assert!(matches!(
            verify(&bad, now(), VerificationPurpose::NewInstall, None),
            Err(TrustError::Signature)
        ));
        let bad = signed_mutation(|p| {
            p["rows"][0]["version"] = "other".into();
        });
        assert!(matches!(
            verify(&bad, now(), VerificationPurpose::NewInstall, None),
            Err(TrustError::Identity)
        ));
        let catalog = verify(&bytes(), now(), VerificationPurpose::NewInstall, None).unwrap();
        let mut manifest = catalog.rows()[0].manifest.clone().unwrap();
        for url in [
            "https://fixtures.invalid.evil/v1/node-24.15.0-darwin-arm64.tar.gz",
            "https://fixtures.invalid/v1/../node-24.15.0-darwin-arm64.tar.gz",
            "http://127.0.0.1/payload",
        ] {
            manifest.archive.url = url.into();
            assert_eq!(
                TrustPolicy::fixture().endpoint(&manifest),
                Err(TrustError::Endpoint)
            );
        }
    }
    #[test]
    fn expiry_replay_equivocation_and_offline_boundaries() {
        let catalog = verify(&bytes(), now(), VerificationPurpose::NewInstall, None).unwrap();
        let later = 1794214800;
        assert!(matches!(
            verify(&bytes(), later, VerificationPurpose::NewInstall, None),
            Err(TrustError::Expired)
        ));
        let offline = verify(
            &bytes(),
            later,
            VerificationPurpose::InstalledReceipt,
            Some(catalog.watermark()),
        )
        .unwrap();
        let row = &offline.rows()[0];
        offline
            .installed_manifest(row.id, &row.version, &row.target)
            .unwrap();
        assert!(matches!(
            offline.install_manifest(row.id, &row.version, &row.target),
            Err(TrustError::Expired)
        ));
        let mut highest = catalog.watermark().clone();
        highest.revision = 2;
        assert!(matches!(
            verify(
                &bytes(),
                now(),
                VerificationPurpose::NewInstall,
                Some(&highest)
            ),
            Err(TrustError::Replay)
        ));
        let equivocation = signed_mutation(|p| {
            p["rows"][0]["reason"] = "changed".into();
        });
        assert!(matches!(
            verify(
                &equivocation,
                now(),
                VerificationPurpose::NewInstall,
                Some(catalog.watermark())
            ),
            Err(TrustError::Replay)
        ));
        assert!(matches!(
            verify(&bytes(), 1, VerificationPurpose::InstalledReceipt, None),
            Err(TrustError::Expired)
        ));
    }
    #[test]
    fn archive_identity_and_revocation_rehearsal() {
        let catalog = verify(&bytes(), now(), VerificationPurpose::NewInstall, None).unwrap();
        let manifest = catalog.rows()[0].manifest.as_ref().unwrap();
        let artifact =
            include_bytes!("../fixtures/components/distribution/node-24.15.0-darwin-arm64.tar.gz");
        VerifiedCatalog::verify_artifact(manifest, artifact).unwrap();
        let mut corrupt = artifact.to_vec();
        corrupt[0] ^= 1;
        assert_eq!(
            VerifiedCatalog::verify_artifact(manifest, &corrupt),
            Err(TrustError::Artifact)
        );
        let revoked = verify(
            include_bytes!("../fixtures/components/distribution/revoked-catalog.json"),
            now(),
            VerificationPurpose::NewInstall,
            Some(catalog.watermark()),
        )
        .unwrap();
        let row = &revoked.rows()[1];
        assert!(matches!(
            revoked.install_manifest(row.id, &row.version, &row.target),
            Err(TrustError::Revoked)
        ));
        assert!(matches!(
            revoked.installed_manifest(row.id, &row.version, &row.target),
            Err(TrustError::Revoked)
        ));
        let original = &catalog.rows()[1];
        assert!(matches!(
            verify(
                &bytes(),
                now(),
                VerificationPurpose::InstalledReceipt,
                Some(revoked.watermark())
            ),
            Err(TrustError::Replay)
        ));
        assert_eq!(original.version, row.version);
    }
}
