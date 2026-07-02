# Line Counter — Bug Analysis & Fix Plan

Last updated: 2026-07-02  
Status: draft  
Related: `specs/text-editor/workspace-manager-idea.md` (future lines column), changelog entry 2026-07-01 (Workspace Settings tab + line counter)

---

## 1) Summary

The **Line counter** in **Workspace Settings → Overview** (reachable from Workspace Manager via **⚙ Settings**) has two reported failure modes:

1. **Stuck in “Counting…”** — the run never appears to finish.
2. **Always shows 0 lines after re-entering** — every workspace looks empty even after a prior successful scan.

The counter is implemented as a manual “Run line count” action in `LineCounterPanel.svelte`, backed by a TypeScript filesystem walker in `services/lineCounter.ts` (port of Unity-AI-Hub `line_count.rs`). It is **not** a column in the Workspace Manager table (that remains future work per the workspace manager spec).

This document captures root causes, how to confirm which case you are hitting, and a phased fix plan.

---

## 2) Current architecture

| Layer | Artifact | Role |
|---|---|---|
| UI | `LineCounterPanel.svelte` | Button-triggered scan; displays total + breakdown |
| Host | `WorkspaceSettingsView.svelte` | Embeds panel, passes `workspaceRootPath` |
| IO | `lineCounter.ts` | Recursive `readDir` + `readFile` walk; newline-byte count |
| Scope | `EditorPaneContent.svelte` | Passes active workspace root into settings view |

**Data flow**

```
User clicks "Run line count"
  → LineCounterPanel.runCount()
  → countLinesInWorkspace(workspaceRoot)
  → walkDir (readDir per directory, readFile per allowlisted file)
  → result stored in component $state (result, scannedAt)
```

**Important constraints**

- Results live only in component-local `$state` — nothing is persisted.
- The walker runs entirely in the frontend with one Tauri IPC roundtrip per `readDir`, `join`, and `readFile` call.
- Markdown, JSON, YAML, TOML, and non-allowlisted extensions are excluded by design.
- Dot-directories and `node_modules`, `target`, `dist`, `build`, `vendor`, `__pycache__` are pruned.

---

## 3) Reported symptoms → root causes

### 3.1 “Always 0 after re-enter”

**Root cause: no persistence + misleading default display.**

`LineCounterPanel` stores the scan in ephemeral state:

```ts
let result = $state<LineCountResult | null>(null);
const totalLines = $derived(result?.totalLines ?? 0);
```

When the user leaves the settings tab (switch to Workspace Manager, another tab, or another workspace context), the panel **unmounts** and `result` is discarded. On return it remounts with `result === null`, and the UI renders **0** via the `?? 0` fallback.

**0 therefore means “not scanned in this mount”**, not “this project has no code.”

The workspace manager spec already defers “background `countLinesInWorkspace` with cache” to future work; no cache module exists yet.

### 3.2 “Stuck forever in Counting…”

**Root cause A: extreme slowness mistaken for a hang.**

`lineCounter.ts` performs sequential async IO for every directory entry:

- `await readDir(dir)` per directory
- `await join(dir, name)` per entry (unnecessary IPC — see fix 5.2)
- `await readFile(fullPath)` per allowlisted file

Tauri’s fs plugin incurs a frontend↔backend roundtrip per call. On repos with thousands of source files this can take minutes and feel like an infinite hang.

**Root cause B: overlapping walks after remount.**

There is no global inflight lock or abort token:

- Leaving the tab does **not** cancel an in-progress walk.
- Returning and clicking **Run line count** again starts a **second** full walk while the first may still be running.
- The `running` guard only blocks double-click on the **same** component instance (`if (running) return`), not across remounts.

**Root cause C: rare hang on problematic paths.**

A named pipe, FUSE mount, or other special file misclassified as a regular file could cause `readFile` to block indefinitely. Less common but possible.

### 3.3 Silent failure looks like “0 lines”

**Root cause: errors swallowed into `readErrors`, never shown in UI.**

When `readDir` fails at a directory, the walker records the error and returns early without throwing:

```ts
} catch (error) {
  acc.result.readErrors.push(`${dir}: ${String(error)}`);
  return;
}
```

`LineCounterPanel` only displays top-level `catch` errors. It does **not** surface `result.readErrors`. A permission or scope failure therefore completes “successfully” with `totalLines: 0` and no visible explanation.

---

## 4) How to confirm which case you hit

Open devtools, go to **Workspace Settings → Overview**, click **Run line count**:

| Observation | Likely cause | Fix priority |
|---|---|---|
| Stays on **Counting…** for many minutes | Performance / concurrent walks | §5.2, §5.3 |
| Finishes quickly with **0**, no error | FS failure in `readErrors`, or project has no allowlisted extensions | §5.1, §5.4 |
| Worked once, **0 after navigating away** | No persistence (§3.1) | §5.1 |
| **0 for all projects** after revisiting each | Same — fresh mount every time | §5.1 |

To inspect silent failures today, temporarily log the return value of `countLinesInWorkspace` and check `readErrors`.

---

## 5) Fix plan

Phases are ordered for incremental delivery. Estimate: **~1–1.5 days** for phases 1–3; phase 4 is optional long-term.

### Phase 1 — UI correctness (~0.25 day)

**Goal:** Stop lying to the user; surface failures.

| # | Fix | Detail |
|---|---|---|
| 1.1 | **Don’t show 0 before a scan** | When `result === null`, display `—` or “Not scanned yet” instead of `0`. Keep breakdown hidden until `result` exists. |
| 1.2 | **Show `readErrors`** | If `result.readErrors.length > 0`, list them (collapsed by default, expandable). Treat non-empty `readErrors` with `totalLines === 0` as a partial or total failure, not success. |
| 1.3 | **`{#key workspaceRoot}`** | Wrap `LineCounterPanel` in `{#key workspaceRoot}` so switching scoped roots resets UI state cleanly. |

**Exit criteria**

- Fresh panel never shows a numeric total before the first run.
- A denied `readDir` at workspace root shows a visible error, not “0 lines”.

---

### Phase 2 — Persist results (~0.25 day)

**Goal:** Survive tab/context navigation; fix “0 on re-enter.”

| # | Fix | Detail |
|---|---|---|
| 2.1 | **In-memory cache module** | New `services/lineCounterCache.ts` (or extend `lineCounter.ts`): `Map<normalizedRoot, { result, scannedAt }>`. Key paths with `normalizePathSync`. |
| 2.2 | **Restore on mount** | `LineCounterPanel` reads cache when `workspaceRoot` is set; populates `result` and `scannedAt` without re-running. |
| 2.3 | **Write-through on success** | After `countLinesInWorkspace` resolves, store in cache. |
| 2.4 | **Optional disk persistence** | Defer unless needed for cross-session survival. In-memory is sufficient for tab re-enter within a session. For Workspace Manager lines column (future), disk cache keyed by path + mtime fingerprint may be warranted. |

**Exit criteria**

- Run count → leave settings → return → previous total still visible.
- Re-run overwrites cache with fresh `scannedAt`.

---

### Phase 3 — Abort, dedupe, and progress (~0.5 day)

**Goal:** Fix apparent hangs and overlapping walks.

| # | Fix | Detail |
|---|---|---|
| 3.1 | **Inflight map per root** | Module-level `Map<normalizedRoot, Promise<LineCountResult>>`. If a walk for the same root is already running, await the existing promise instead of starting another. |
| 3.2 | **Abort on unmount / root change** | Pass an `AbortSignal` into `countLinesInWorkspace`. On `$effect` cleanup (or `{#key}` destroy), abort. Ignore results when `signal.aborted`. |
| 3.3 | **Progress callback** | Add optional `onProgress?: (info: { relPath: string; filesScanned: number }) => void` to the walker. Panel shows “Scanning … (N files)” while running. |
| 3.4 | **Yield to event loop** | Every N files (e.g. 50), `await new Promise(r => setTimeout(r, 0))` so the UI thread can repaint during long scans. |

**Exit criteria**

- Rapid leave → return → re-run does not spawn duplicate walks for the same root.
- Long scan shows progress; button state recovers on abort.

---

### Phase 4 — Performance (~0.5 day short-term; longer for Rust)

**Goal:** Make scans fast enough that “Counting…” rarely exceeds a few seconds.

| # | Fix | Detail |
|---|---|---|
| 4.1 | **Sync path joining** | Replace `await join(dir, name)` with synchronous `${base}/${name}` (same pattern as `projectTree.ts` and `joinDirectoryPath` in `folderOpenableFiles.ts`). Eliminates one IPC call per directory entry. |
| 4.2 | **`ensureWorkspaceReadAccess` before walk** | Call `ensureWorkspaceReadAccess(workspaceRoot)` at start of `runCount` (same as workspace add / project tree startup). Surfaces blocked access early with a clear message. |
| 4.3 | **Skip oversized files** | Optional size check via `stat` before `readFile`; skip files above a threshold (e.g. 1–5 MiB) and record in `readErrors` or a new `skippedFiles` list. Prevents minutes spent reading minified bundles. |
| 4.4 | **Rust-side walker (long-term)** | Single Tauri command that walks and counts server-side, returns `{ totalLines, codeFileCount, … }` in one IPC roundtrip. Required for Workspace Manager **lines column** at scale (see workspace manager spec §7). TypeScript walker remains for unit tests of allowlist/pruning logic. |

**Exit criteria**

- spec-ops repo scan completes in under ~10s on a typical dev machine (target; measure and adjust).
- Path joining no longer uses per-entry `join()` IPC.

---

## 6) Files likely touched

```
app/src/lib/components/settings/LineCounterPanel.svelte
app/src/lib/components/settings/WorkspaceSettingsView.svelte   (optional {#key})
app/src/lib/services/lineCounter.ts
app/src/lib/services/lineCounterCache.ts                       (new, phase 2)
app/src/lib/services/lineCounter.test.ts                       (extend)
app/src-tauri/src/...                                          (phase 4.4 only)
specs/changelog.md
```

---

## 7) Tests

| Test | Phase |
|---|---|
| Cache round-trip: store → get by normalized path | 2 |
| Inflight dedupe: two concurrent calls for same root → one walk | 3 |
| Abort: signal aborted mid-walk → promise rejects or returns partial | 3 |
| UI: `result === null` → no numeric total rendered | 1 |
| Walker: sync path join produces same paths as before | 4 |
| Existing pure helpers (`extensionOf`, `countNewlines`, `classifyExtension`) unchanged | — |

---

## 8) Out of scope (for this fix pass)

- **Lines column in Workspace Manager table** — separate feature; needs background scan + cache shared across workspaces (workspace manager spec §7).
- **Disk-persisted cache across app restarts** — defer until manager column is implemented.
- **Including Markdown / JSON in counts** — intentional product decision; allowlist matches Unity-AI-Hub LineWalker.

---

## 9) Reference — key code locations

**Ephemeral state (persistence bug)**

```6:11:app/src/lib/components/settings/LineCounterPanel.svelte
  let result = $state<LineCountResult | null>(null);
  ...
  const totalLines = $derived(result?.totalLines ?? 0);
```

**Silent FS errors**

```130:135:app/src/lib/services/lineCounter.ts
  try {
    entries = await readDir(dir);
  } catch (error) {
    acc.result.readErrors.push(`${dir}: ${String(error)}`);
    return;
  }
```

**Per-entry IPC join (performance)**

```141:143:app/src/lib/services/lineCounter.ts
    const name = entry.name;
    const fullPath = await join(dir, name);
```

**Preferred path join pattern (project tree)**

```78:85:app/src/lib/services/projectTree.ts
  const base = dirPath.replace(/[\\/]+$/, "");
  ...
    const path = `${base}/${entry.name}`;
```

---

## 10) Implementation order (recommended)

1. Phase 1 — stop showing misleading 0; show `readErrors`
2. Phase 2 — in-memory cache (fixes re-enter)
3. Phase 4.1 — sync path join (quick perf win)
4. Phase 3 — inflight dedupe + progress + abort
5. Phase 4.2–4.3 — access check + large-file skip
6. Phase 4.4 — Rust walker (when building manager lines column)
