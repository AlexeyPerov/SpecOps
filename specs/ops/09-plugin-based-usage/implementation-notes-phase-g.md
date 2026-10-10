# AS09-G — Deliberate maintenance and security source evidence

**Recorded:** 2026-10-11 00:07 MSK; Darwin arm64 source workspace; app 0.3.0 / host 0.1.0; source follows F `303552a`; manifest/catalog schema 1. Production engineering catalog revision 1 still has five unavailable rows and no approved metadata/artifact endpoint. Fixture revisions 1–3 and synthetic compatible Codex 0.160.1/0.160.2 maintenance rows are test-only. Synthetic updates are not vendor releases or a claim that the shipped host supports those vendor versions.

## Metadata, updates and retained selection

Native refresh is a concrete bounded credential-free HTTPS request to an exact application-owned catalog endpoint, followed by strict signature/compatibility verification and atomic signed envelope caching with a monotonic watermark. Production has no approved endpoint, so explicit Check tested updates reports unavailable. Only test builds can use logical fixture trust and a bounded loopback HTTP transport; release code accepts no arbitrary key, origin, environment or archive trust override. Failed refresh keeps previously accepted metadata; lower revisions, same-revision equivocation, omission of known revocations and changed immutable manifest identities or dropping a still-installed/active authenticated manifest fail closed. Accepted revocations remain effective after reopening/offline without resetting the watermark or falling back to an older embedded catalog.

Inventory now produces exact compatible tested-update offers, verified retained versions and in-use states. Fresh metadata and the complete app/host/adapter/dependency plan are required for offers and selection. A deliberate reviewed update downloads into immutable owned software; a current lease prevents active selection changes, even if a new verified version is retained after the attempt. Shared prerequisites remain pinned. No silent stop/restart, login/logout, session replacement or prompt replay is added. Actual allocated active software is checked against the 4 GiB budget before activation; reviewed plan admission also bounds the proposed logical payload total and required reserve/staging space.

Native-store transition checks compare the authenticated current and candidate native-store contracts, reject unknown/different/missing contracts and preserve private native data. This is necessary software compatibility evidence, **not an observation of a real vendor's persisted store schema**. No production transition is available under this catalog. Actual accepted update/rollback compatibility against original vendor stores remains G-01/H acceptance. There is no data migration, compatibility shim, native-store rewrite or history reset.

## Disk ownership and reclamation

Diagnostics and Software show actual filesystem allocation (512-byte allocated blocks on Unix): active agents, retained agents, shared Node counted once, staging and cache. Full bounded version-tree traversal adds unrecognized identities/directory metadata to a preserved separate bucket instead of omitting their consumption. Logical signed manifest/download sizes remain distinct from allocated bytes.

Budgets remain A's 4 GiB active software, 1 GiB archive cache, one unleased inactive retained version per component and 256 MiB free reserve plus compressed + twice unpacked staging requirements. The installer currently retains no archive cache; owned staging is cleared at deterministic completion/recovery boundaries. Atomic activation applies the inactive retention policy, skipping leases/dependents. Separate Clean excess retained software applies the same guarded policy. Cache cleanup preserves active/retained installations and removes only authenticated archive names or abandoned operation-owned staging, under the global OS lock; unmarked foreign staging is preserved. No profile/native history root is traversed.

Reviewed all-software removal binds the exact current catalog and finite installed versions in a digest. Confirmation recomputes that plan under the global lock and preflights **all** version leases before deleting any software, then removes dependent agents before shared Node. A running version blocks the entire preflight without stopping it. Unrecognized version identities are preserved and conservatively block shared Node removal; the review removes only listed authenticated versions. Software IO errors can leave a partial removal; subsequent inventory/review handles remaining finite software. Native history/account/workspace canaries remain intact.

## Filesystem and launch trust

Unix store directory/file traversal uses held fds, `openat` and `O_NOFOLLOW`; private creation, atomic replacement and bounded recursive cleanup use `mkdirat`, `renameat` and `unlinkat`. Directory permissions/ownership, regular-file single-link ownership, receipt read-only mode, manifest file modes and full hashes are enforced. Hardlinked temporary metadata is rejected **before** truncation. Hash validation checks the reopened file identity against the held file after hashing. Runtime leases retain the root directory identity; later path substitution is rejected at request revalidation. Permission changes are rejected, not silently repaired.

The native Agent Host bridge revalidates every owned lease against the latest authenticated catalog and complete receipt/graph before executable component requests. This closes cached host binding reuse after signed revocation or disk tampering. Existing owned turn.cancel/permission.reply/question.reply cleanup remains available; the leased process/generation is not silently replaced or stopped. Processes retain immutable version locks until existing owned descendant cleanup exits.

Embedded public trust now contains a strict bounded reviewed key list (at most four exact keys) with catalog revision intervals. A reviewed application release establishes the next key before catalog signer rotation, while explicitly retained old keys continue to verify retained manifests. Unknown/self-nominated keys and out-of-interval catalog signers fail; the watermark prevents replay of an old signer catalog after rotation. Removing a compromised key still requires an application release and can block affected old manifests; no untrusted import or receipt migration is offered. The engineering candidate key remains unapproved for production.

## Verification ledger

All tests below are no-account source/finite fixture controls. Tiny executable fixture archives are not actual vendor software. The real supervised host uses the existing explicitly selected test Node; its fixture lease proves version/process ownership, not execution of fixture Node as the host runtime. Existing E real-candidate evidence is unchanged and was not rerun as production G acceptance.

| Check | Result |
| --- | --- |
| Final serial native suite | Pass: 114 tests; one separately opt-in real-candidate integration ignored |
| Native catalog/manager security subset | Pass: 25 tests; one opt-in integration ignored, before the extra real-host request-boundary test |
| Actual bounded loopback metadata requests | Pass: signed revocation accepted; redirect/status/truncated/corrupt rejected; no Authorization/cookies/credential canary; arbitrary HTTP/userinfo URLs rejected |
| Signed revision replay, equivocation/expiry/offline and cumulative revocation omission | Pass: source signatures/cache/reopen; no watermark reset |
| Reviewed signer overlap, unknown/new key denial, retired catalog signer and retained manifest verification | Pass: independently signed source key rotation fixture |
| Pending compatible update with live lease; verified retained selection; unknown native-store contract | Pass: actual local fixture download/extraction; lease blocks activation; explicit selection; unknown blocks plan |
| Tampered leased executable/receipt/tree, hardlinks, private permissions and nofollow paths | Pass: source disk fixtures fail before new work |
| Concurrent ancestor substitution during atomic metadata write/unlink | Pass: 200 operations against a real racing filesystem thread; outside sentinel and pending files untouched |
| Allocated disk/unknown identities, foreign staging, independent cleanup, retention and reviewed group removal | Pass: actual filesystem allocation and private history canaries; all leases preflight before removal |
| Cancellation, crash checkpoints, shutdown, old active selection, low-space admission, sibling dependency failure and separate-process lock death | Pass: source matrix, including real child/host processes; low disk is injected, not a filled system disk |
| New real supervised host revocation request boundary | Pass: turn.start fails after signed revocation, existing generation remains running, cleanup replies remain available; software removal stays blocked until explicit stop |
| Existing resistant descendant, crash and generation cleanup controls | Pass: full native suite; source host processes |
| SoftwarePanel / profile / handoff / component event suites | Pass: 25 tests, including explicit remote check/group review/no implicit install/diagnostic copy |
| Svelte official docs/autofixer, type/Svelte check | Pass: no issues, 0 errors / 0 warnings; optional bind:this suggestions retained for reviewed focus |
| Web production build | Pass; existing chunk-size/pure-comment notices remain |
| Public Markdown links | New G links pass; one pre-existing archived terminal-question anchor remains failed |

**Failed then corrected:** the first fd-based open used `/dev/fd/<directory>/<leaf>`, which Darwin does not resolve; it was replaced with direct `openat`. A test used the wrong revocation fixture basename and was corrected before running. Hardlink review found truncation occurred before the link-count check; the write path now checks the held fd before truncating, with a dedicated canary assertion. Final passing results above are after these corrections.

**Not-run:** actual full filesystem ENOSPC write/fsync faults, OS reboot/power-loss, clean signed installed multi-window concurrency/quarantine/process identity, actual real-vendor compatible update/rollback/reconnect with original native stores, real provider/account isolation/inference/native enforcement and ten-run startup/RSS/disk release measurements. Source simulated low-space/crash boundaries and real fixture threads/processes are recorded separately from these gates.

**Unavailable:** approved production metadata/artifact hosting, publication, commercial distribution clearance, reviewed release signing custody, clean current signed installed baseline and available production update candidates. No install/account/installed/native-store acceptance is inferred from source build or these fixtures.

## Task dispositions and public recovery

G-02/G-04/G-06 source acceptance passes: actual bounded accounting/ownership, isolated finite network/log/error boundaries, and [public recovery](../../../docs/agent-software.md)/[developer packaging](../../../docs/component-packaging.md) are implemented and tested. G-01/G-03/G-05 source implementation/security fixtures land; their complete real native-store/clean installed/trust/full-disk/reboot/adversarial acceptance stays open for H. No historical A–F record was rewritten.

Copy software diagnostics is explicit and contains bounded versions/catalog/target, inventory, actual disk buckets and finite installer jobs/errors, without archive URLs, private paths, account identifiers/credentials/history or vendor logs. Recovery documentation distinguishes software, authentication, entitlement, native policy and vendor availability. Verified manual recovery uses an approved signed app and finite managed controls; damaged trust fails closed. No unverified import, trust watermark reset, quarantine bypass or account/history deletion is advised.
