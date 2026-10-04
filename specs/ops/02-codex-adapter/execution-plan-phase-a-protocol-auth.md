# 02 — Phase A: isolated connection, protocol and authentication

**Date:** 2026-10-04

**Status:** Planned

**Prerequisites:** AS01-S accepted. Claude is not a prerequisite.

**Scope:** [README](README.md) · [Execution index](execution-plan.md) · [Roadmap](../roadmap.md)

## Goal

Connect a SpecOps-owned Codex profile to a supported app-server without touching the separate desktop app account.

## Implementation boundary

Own profile identity/storage, child process, pinned schemas, auth/control-plane events, neutral Sessions discovery and creation shell. Native turns belong to B.

## Native reference

Use the pinned version of the official [App Server](https://learn.chatgpt.com/docs/app-server), [Authentication](https://learn.chatgpt.com/docs/auth) and [configuration](https://learn.chatgpt.com/docs/config-file/config-advanced). Record supported methods rather than assuming every current documentation field exists in the pinned executable.

## Tasks

### AS02-A-01 — Resolve and supervise the pinned app-server

Run a bounded feasibility probe against the official supported binary: executable discovery/version, stdio initialization and required methods; record distribution/licensing and configuration. Launch one app-server per active profile; many workspace threads may share it. Restart a profile child without restarting Agent Host.

**Acceptance:** Report executable/version/API support evidence, missing/incompatible/setup states and child generation. Unsupported required interfaces fail before work; profile-child failure does not stop another profile.

### AS02-A-02 — Generate contracts and define profile-aware routing

Generate reproducible TypeScript/schema artifacts from the pinned binary. Keep RPC transport separate from replayable event mapping. Add connectionProfileId to native/session binding, requests, replies, catalogs, health, event envelope and persisted codecs; distinguish native item/turn IDs from host cursor. Route auth updates outside turn streams.

**Acceptance:** Schema generation has a clean diff; initialization uses actual native handshake. Equal native IDs across profiles never collide. Unknown additive notifications become bounded diagnostics, incompatible required payloads fail explicitly.

### AS02-A-03 — Create isolated home and credential boundary

Create profile home in app data outside workspace; pass CODEX_HOME to child only, initially explicit file credential storage. Restrict directory/file permissions and exclude from exports. Do not copy default auth/home. Control inherited auth/provider variables so they cannot override selected profile credentials, preserving necessary workspace environment. Persist nonsecret profile metadata only.

**Acceptance:** Fixtures prove desktop/default home remains unchanged and ambient auth cannot hijack profile. Tokens/keys/auth URL query/device codes are excluded from logs, errors, frontend state and persistence. Keyring is absent unless separate namespace isolation is proven.

### AS02-A-04 — Implement official account lifecycle

Map supported API-key and ChatGPT browser/device login, account read/update, completion/cancel, logout and re-auth. Correlate profile/login ID/process generation; use dedicated auth updates independent of turns. Show actual selected account after login; browser may already be signed in to another account. Logout remains profile-local.

**Acceptance:** Stale login completions cannot overwrite a new attempt. Login opened is not authenticated. Profile B shows verified identity; logout B does not alter default desktop credentials. Unavailable device/login methods have an explicit support state.

### AS02-A-05 — Build neutral discovery and profile creation UI

Replace provider-shaped Sessions enablement with neutral settings. Ensure-start before discovery/catalogs; retry after child/host recovery. Build runtime/profile selection and missing-runtime/auth-required/error states. Binding fixes profile once native session is created; B adds settings and turn controls.

**Acceptance:** Creating Codex does not require enabling OpenCode; fresh draft can discover runtime/catalogs before first send. Session/profile metadata round-trips through production persistence and cannot silently switch an existing native binding.

### AS02-A-06 — Verify bootstrap and isolated login

Add no-account fixtures for missing/unsupported executable, malformed init, profile namespaces, environment policy, permissions, redaction, auth cancellation/stale generation and catalog retry. Record a manually gated account-B sign-in while desktop A remains signed in.

**Acceptance:** Tests use no live secret by default. The supported actual login flow verifies B and preserves A; failures retain explicit recoverable state. API-key/device variants have fixture coverage and actual support scope documented.

## Verification

- Regenerate pinned schemas; run host/client/profile codec, auth/control-plane, catalog/UI and process tests.
- Inspect output/storage fixtures using credential canaries and profile routing collisions.
- Opt-in browser/device login under supported account conditions; record binary version and default-home preservation without exporting credentials.

## Exit and next work

B starts with a stable isolated authenticated connection. 03-B may prepare packaging after S and use B for installed runtime smoke. Mark tasks Done only with recorded evidence; update scope/index/roadmap and `specs/changelog.md` when implementation lands. No persisted-data migrations or compatibility shims.
