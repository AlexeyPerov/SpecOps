# Cross-Context File Opening — Implementation Plan

Last updated: 2026-07-02  
Status: approved for implementation  
Related: `openFileGate.ts`, `workspacePaths.ts`, `tabTransferSlice.ts`, `documentSave.ts`

---

## 1) Summary

Today, file opens are **context-restricted by default**:

- Paths outside the active workspace root force a switch to **Notepad** before open.
- A workspace file already open in Notepad is **migrated** into the active workspace when opened from that workspace.
- Save / Save As to a path outside the workspace root **moves the tab to Notepad**.

This plan adds a **global, opt-in restriction** so users can instead open any file in whichever context they are currently in (Notepad or any workspace). **One tab per normalized file path per window** remains enforced everywhere; cross-window ownership via the open-file registry is unchanged.

**Default:** restriction **off** (new behavior).  
**When enabled:** current behavior is preserved exactly.

---

## 2) Goals

| Goal | Detail |
|---|---|
| Flexibility | Workspace files may live in Notepad; outside-workspace files may live in a workspace tab strip |
| Safety | No duplicate tabs for the same path within a window; no change to cross-window dedupe |
| Reversibility | Users who prefer today’s model can re-enable restriction in Settings |
| Minimal surface | Reuse existing open pipeline, migration, and save helpers — no new tab model |

---

## 3) Decisions (locked)

| # | Topic | Choice |
|---|---|---|
| 1 | File already open in another context (unrestricted) | **Focus existing tab** — switch to owning context; do not migrate |
| 2 | Save As outside active workspace root (unrestricted) | **Stay in current context** — no forced move to Notepad |
| 3 | Setting scope | **Global app setting** (persisted in `settings.json`) |
| 4 | Settings placement | **Editor → Contexts** subsection (new) |
| 5 | Path not under active workspace root, opened in that workspace (unrestricted) | **Allow** — open in active context |
| 6 | Cross-window ownership | **Unchanged** — one owning window per path via open-file registry |
| 7 | Restricted mode: workspace file already in Notepad | **Keep today** — migrate notepad tab into workspace on workspace open |
| 8 | Project tree / project search entry points | **Open in that workspace** — results land in the workspace context |

### 3.1 Setting definition

| Field | Value |
|---|---|
| Key (persisted) | `restrictFilesToContext` |
| In-app type | `boolean` on `AppSettingsState` |
| Default | `false` |
| UI label | **Restrict files to their context** |
| Help text | When on, files outside the workspace open in Notepad and workspace files stay in workspaces. When off, files open in whichever context you are in; each file still has only one tab. |

**Semantics**

- `restrictFilesToContext === true` → **restricted** (legacy / current behavior)
- `restrictFilesToContext === false` → **unrestricted** (new default)

---

## 4) Behavior specification

### 4.1 Open pipeline (`requestOpenPath`)

Shared for all entry points that call `openActivePath` / `openActivePathInPane` (project tree, recent files, CLI, double-click, project search, etc.).

```
1. Cross-window registry check (unchanged)
   → redirect to owning window if another window owns the path

2. IF restricted AND active context is a workspace AND path is under that workspace root:
   → try migrateNotepadFileTabToWorkspace (unchanged)

3. IF file already open anywhere in this window:
   → switchContext(owningContext) + select/focus tab (unchanged)
   → return existing

4. IF restricted AND active context is a workspace AND path is outside workspace root:
   → switchContext("notepad") before read/open (today's ensureNotepadForOutsidePath)

5. ELSE (unrestricted OR path is in-root OR active context is notepad):
   → open in active context; no forced context switch
```

**Unrestricted examples**

| Active context | Path | Result |
|---|---|---|
| Workspace A | `/tmp/notes.txt` | Opens tab in Workspace A |
| Notepad | `/workspace-a/src/main.ts` | Opens tab in Notepad |
| Workspace A | `/workspace-a/foo.ts` (already open in Notepad) | Switch to Notepad, focus existing tab |
| Workspace B | `/workspace-a/foo.ts` (already open in Workspace A) | Switch to Workspace A, focus existing tab |

**Restricted examples (unchanged)**

| Active context | Path | Result |
|---|---|---|
| Workspace A | `/tmp/notes.txt` | Switch to Notepad, then open |
| Workspace A | `/workspace-a/foo.ts` (in Notepad) | Migrate tab to Workspace A |
| Workspace A | `/workspace-a/foo.ts` (already in Workspace A) | Focus existing tab |

### 4.2 Save and Save As

| Action | Unrestricted | Restricted |
|---|---|---|
| Save (in-place) | No tab move | No tab move |
| Save As to outside-root path | Tab stays in current context; update document path in place | Close tab in workspace, reopen in Notepad (today) |
| Save on close (dirty prompt) | Same as Save — no tab move | May move tab to Notepad if saved outside root (today via `allowWorkspaceTabMove`) |

Implementation note: `documentSave.ts` already gates tab move behind `options.allowWorkspaceTabMove`. Wire that flag to `settings.restrictFilesToContext` at call sites instead of hard-coding `true`.

### 4.3 File menu / command entry points

These currently call `runInNotepadContext`, which unconditionally switches to Notepad:

| Caller | Change |
|---|---|
| `commands/handlers/file.ts` (File → Open) | Only call `runInNotepadContext` when restricted |
| `commands/handlers/fileActions.ts` (Open All in Folder) | Same |
| `services/tabContextMenuActions.ts` (Open All Nearby) | Same |

When unrestricted, run the open handler in the **active context** without switching.

### 4.4 Project tree and Find in Project

No change to routing target: opens always go through `openActivePath` while the workspace is active. With restriction off, outside-root paths opened via recent/global search while in a workspace stay in that workspace; tree/search hits for in-root paths behave as today.

### 4.5 Out of scope (v1)

| Item | Notes |
|---|---|
| Bidirectional tab migration on open | Deferred — focus-existing is sufficient |
| Per-workspace override | Global setting only |
| “Ask each time” prompt | Not in v1 |
| Cross-window same file in multiple windows | Registry unchanged |
| Move tab to new window from workspace contexts | Still Notepad-only (`tabWindowTransfer.ts`) |

---

## 5) Technical approach

### 5.1 Settings stack

Follow the `defaultMarkdownViewMode` / `externalFiles` pattern:

| Layer | Change |
|---|---|
| `domain/settings.ts` | Add `restrictFilesToContext: boolean` to `AppSettingsState` |
| `state/appState/settingsSlice.ts` | Default `false`; setter `setRestrictFilesToContext` |
| `services/settingsStore.ts` | Persist + normalize (boolean, default `false`) |
| `services/appShellRuntime.ts` / `appShellEffects.ts` | Load into app state on startup |
| `components/settings/EditorSettingsPanel.svelte` | New **Contexts** `<section>` with toggle |

Add a small read helper used by services (avoid importing UI):

```ts
// services/fileContextPolicy.ts (new, ~15 lines)
export function isFileContextRestricted(): boolean {
  return appState.getSnapshot().settings.restrictFilesToContext;
}
```

### 5.2 Open gate refactor

| File | Change |
|---|---|
| `services/openFileGate.ts` | Branch steps 2 and 4 on `isFileContextRestricted()`; skip `ensureNotepadForOutsidePath` when unrestricted |
| `services/workspacePaths.ts` | Optionally add `ensureContextForPath(path)` that delegates to restricted vs unrestricted policy (keeps `ensureNotepadForOutsidePath` for restricted path) |

`findLocalDocumentForNormalizedPath` and cross-window redirect: **no change**.

### 5.3 Save paths

| File | Change |
|---|---|
| `services/documentSave.ts` | `saveDocumentForClose` passes `allowWorkspaceTabMove: isFileContextRestricted()` |
| `commands/handlers/fileActions.ts` | Gate Save As tab move + notification copy on setting |

### 5.4 `runInNotepadContext` call sites

Replace unconditional wrappers with:

```ts
async function runOpenInActiveContext<T>(fn: () => Promise<T> | T): Promise<T> | T {
  if (isFileContextRestricted()) {
    return runInNotepadContext(fn);
  }
  return fn();
}
```

Place in `workspacePaths.ts` or `fileContextPolicy.ts`; update three call sites listed in §4.3.

### 5.5 Tests to update / add

| File | Cases |
|---|---|
| `openFileGate.test.ts` | Unrestricted: outside path stays in workspace; in-notepad workspace file opened from workspace focuses Notepad (no migrate). Restricted: existing migrate + notepad switch tests unchanged. |
| `workspacePaths.test.ts` | Policy helper branches |
| `documentSave` / `fileActions` tests | Save As outside root: no move when unrestricted; move when restricted |
| `settingsStore.test.ts` | Persist round-trip, default `false` |
| Handler smoke | File → Open does not switch context when unrestricted |

---

## 6) Implementation phases

Total estimate: **~1–1.25 days**.

### Phase 1 — Setting plumbing (~0.25 day)

**Deliverables**

- `restrictFilesToContext` end-to-end: domain → slice → persistence → runtime load
- `fileContextPolicy.ts` helper
- Editor Settings → **Contexts** section with toggle + help text

**Exit criteria**

- Toggle persists across restart; defaults to off on fresh install
- `isFileContextRestricted()` returns persisted value

---

### Phase 2 — Open pipeline (~0.5 day)

**Deliverables**

- `requestOpenPath` branches on setting (§4.1)
- `runOpenInActiveContext` wrapper; update File → Open, Open All in Folder, Open All Nearby
- Unit tests for unrestricted and restricted open paths

**Exit criteria**

- Unrestricted: `/tmp/x` opens in active workspace without context switch
- Unrestricted: workspace file already in Notepad → focus Notepad (no duplicate, no migrate)
- Restricted: all existing `openFileGate.test.ts` cases still pass

---

### Phase 3 — Save alignment (~0.25 day)

**Deliverables**

- Gate Save As / save-on-close tab move on setting
- Update notification strings (no “moved tab to Notepad” when unrestricted)

**Exit criteria**

- Save As outside root leaves tab in workspace when unrestricted
- Restricted Save As behavior unchanged

---

### Phase 4 — Tests & changelog (~0.25 day)

**Deliverables**

- Remaining unit tests from §5.5
- Changelog entry in `specs/changelog.md`
- Manual smoke checklist (below)

**Exit criteria**

- Full test suite green
- Manual checks pass

---

## 7) Manual test checklist

- [ ] Fresh install / reset settings: toggle off by default
- [ ] Unrestricted + workspace active: File → Open `/tmp/outside.txt` → tab in workspace, no Notepad switch
- [ ] Unrestricted + Notepad active: open workspace file → tab in Notepad
- [ ] Unrestricted: same file open in Notepad; open from workspace tree → switches to Notepad, one tab
- [ ] Unrestricted: Save As outside workspace root → tab stays, path updates
- [ ] Restricted (toggle on): above outside-path opens switch to Notepad
- [ ] Restricted: workspace file in Notepad migrates on workspace open
- [ ] Cross-window: file open in window A → open in window B redirects (both modes)
- [ ] Project search result opens in workspace (both modes)
- [ ] Toggle restricted on mid-session: subsequent opens follow restricted rules (no migration of existing tabs)

---

## 8) Files likely touched

```
app/src/lib/domain/settings.ts
app/src/lib/state/appState/settingsSlice.ts
app/src/lib/state/appState/settingsSlice.test.ts
app/src/lib/services/settingsStore.ts
app/src/lib/services/settingsStore.test.ts
app/src/lib/services/appShellRuntime.ts
app/src/lib/services/appShellEffects.ts
app/src/lib/services/fileContextPolicy.ts                    (new)
app/src/lib/services/openFileGate.ts
app/src/lib/services/openFileGate.test.ts
app/src/lib/services/workspacePaths.ts
app/src/lib/services/workspacePaths.test.ts
app/src/lib/services/documentSave.ts
app/src/lib/commands/handlers/file.ts
app/src/lib/commands/handlers/fileActions.ts
app/src/lib/services/tabContextMenuActions.ts
app/src/lib/components/settings/EditorSettingsPanel.svelte
specs/changelog.md
```

**Not expected to change:** `tabTransferSlice.ts` (migrate helper stays; only gated at call site), `openFileRegistry.ts`, project tree/search modules, `tabWindowTransfer.ts`.

---

## 9) Risks & mitigations

| Risk | Mitigation |
|---|---|
| Missed entry point still forces Notepad | Grep for `runInNotepadContext`, `ensureNotepadForOutsidePath`, `switchContext("notepad")` in open/save paths; audit in Phase 4 |
| `openFileInTab` dedupes only active context if bypassed | All user opens should go through `requestOpenPath`; document in comment if any internal caller bypasses gate |
| User confusion: workspace file in Notepad without agents sidebar | Help text explains tradeoff; agents remain workspace-scoped |
| Mid-session toggle leaves “misplaced” tabs | Accept for v1 — no retroactive migration on toggle |
| Save-on-close vs Save As inconsistency | Both use same `isFileContextRestricted()` gate |

---

## 10) Future work (not v1)

| Item | Notes |
|---|---|
| Migrate-to-current-context on open | Option B from design review; bidirectional `migrateFileTabToContext` |
| Per-workspace restriction override | Workspace Settings toggle overriding global default |
| Visual hint for “foreign” tabs | Badge when tab path ∉ workspace root |
| Persist tab context hints on restore | Optional cleanup pass on session load |
