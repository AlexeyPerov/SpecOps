# Agent software and recovery

SpecOps keeps optional agent executables and shared Node software separate from account credentials, native profiles, workspace sessions and history. Use **Settings → Software**, or **Manage selected software** in Sessions. Production downloads currently remain unavailable: approved distribution, hosting and signing are still required. An unavailable entry cannot be installed by pasting a URL or choosing an arbitrary executable.

## Installation and offline use

Review the exact component versions, prerequisites, download size and free disk requirement. Confirm **Install reviewed components** explicitly. Opening Settings or selecting an agent does not download, connect an account, create a native session or submit a prompt. Cancel waits for the actual job to finish cancellation. Retry requires a current reviewed plan; expired plans require another review.

The editor works without optional agents. Already installed, authenticated and compatible software can be revalidated offline using previously accepted signed metadata, including expired metadata. Missing software, updates and selecting another retained version require fresh metadata. Provider authentication, entitlement, service connectivity and native policy remain separate requirements. A known signed revocation still blocks new work offline.

## Updates, retained versions and removal

**Check tested updates** contacts only the application-approved catalog endpoint. Until an endpoint is approved, it reports unavailable and preserves existing software. A failed refresh preserves the last accepted signed metadata. Only exact tested versions compatible with the shipped app, host and adapter can appear in an update review. No vendor latest version, package install script or automatic download is used.

Review updates before downloading. Running software holds its exact version. Activation and removal are blocked until its owned processes stop; finish or cancel work and disconnect explicitly, then review again. An interrupted update may leave a verified retained version without changing the active version. Select it explicitly after stopping activity. Reconnecting and continuing the original session also remain explicit; uncertain work is never resent.

A retained version can be selected only when its authenticated software and native-store contract are compatible. Unknown or different native-store revisions block selection. Software rollback does not upgrade, downgrade, convert or reset native history. Do not bypass an incompatibility by deleting account or history files. Actual vendor store compatibility still requires release acceptance for the specific version pair.

The panel reports allocated filesystem blocks separately for active agents, retained agents, shared Node (counted once), staging and archive cache. Unrecognized identities and directory metadata are reported separately and preserved. Signed manifests show logical payload/download sizes; those estimates differ from allocated filesystem blocks. Budgets are 4 GiB of active software, 1 GiB of archive cache, one unleased inactive retained version per component, and a 256 MiB free-space reserve in addition to download and staging requirements. Leased or depended-on versions are never reclaimed to meet a budget.

**Clean archive cache** removes only recognized software archives and abandoned operation-owned staging under the global installer lock. It preserves active and retained installations. **Clean excess retained software** separately applies retention to authenticated, unleased versions. Another installer's staging and all native data remain excluded. Unknown artifacts can consume space; report them to support instead of deleting unrelated directories.

Individual removal preserves credentials and history. **Review all software removal** lists exact authenticated installed versions and removes only those listed agents before shared Node after confirmation. Unknown identities are preserved and conservatively block shared Node removal. Every version lease is checked before any removal. If activity starts after review, the operation is blocked; nothing is stopped automatically. Storage failures can leave a partially removed group; refresh inventory and review the remaining software again.

## Safe diagnostics and incident response

Use **Copy software diagnostics** to copy bounded software/catalog identities, versions, states, sizes and installer job/error codes. It excludes account credentials, account identifiers, history contents, archive URLs, private filesystem paths and vendor logs. Review the copied report before sharing it. Keep actual runtime/account/provider logs separate and redact them before submitting a support report.

| Symptom | Recovery and support scope |
| --- | --- |
| Missing, damaged or interrupted software | Review installation or remove and reinstall only the affected software. Preserve the original profile/session and reconnect explicitly. |
| Storage, low disk or another installer busy | Free unrelated disk space safely; use the separate software cleanup controls; retry after the owning installer finishes. |
| Authentication or entitlement failure | Use the account connection controls and provider guidance. Reinstalling software does not log out or purchase access. |
| Native policy or vendor service failure | Inspect the existing approval/policy or provider availability. A successful install does not prove provider access. |
| Revoked or changed execution identity | Finish or cancel owned work, stop it explicitly, update the application if required, then review a cleared compatible component. No silent process replacement occurs. |
| Native-store incompatibility | Preserve native data and report the exact app/component versions. Select only a release-tested compatible version; no data conversion or deletion is offered. |

Catalog replay, signature failure, changed directory permissions, symlink substitution, hardlinked metadata or tampering block execution. Do not erase trust watermarks, import unsigned archives, add a new signing key, disable integrity checks, clear quarantine or run downloaded shell scripts as a workaround. Key rotation is a reviewed application update; downloaded artifacts cannot authorize their own key.

Manual verified recovery is a support/release engineering procedure: obtain a reviewed signed application release with the approved trust roots and catalog, verify its distribution identity, then use its finite Software installation/removal controls. Do not copy arbitrary executables into the component store. If trust metadata itself is damaged or cannot be authenticated, preserve the store and native data for diagnosis; the application intentionally fails closed until a verified release/support procedure can establish the exact identity. No user-facing unverified import or persisted-data migration is supported.


## Current release support

The current source candidate targets macOS Apple silicon (Darwin arm64) with app
0.3.0, host 0.1.0, shared Node 24.15.0, Codex 0.160.0, OpenCode 1.17.4,
Claude SDK 0.3.289/native 2.1.289 and Cursor SDK 1.0.35. Native install and copied
no-account controls have been tested; production distribution remains unavailable.
There is no accepted downloadable component target yet. Historical installers do
not establish support for this delivery mode. Intel macOS, Windows and Linux agents
remain unsupported until their own release gates pass.

The editor needs no optional agent installation or account. Version Control still
uses the system Git prerequisite. First agent use adds shared Node once and that
agent's execution files; installing all agents has a separate combined disk cost.
Candidate regular-file/gzip size results do not establish installer size, startup
speed or RAM savings. Do not use developer executables, unsigned imports or
quarantine removal to work around unavailable delivery.
