# Changelog

## 2026-08-18 16:11 MSK — Stop lowercasing paths in Copy Path / Copy Relative Path

- Copy Path and Copy Relative Path (tab menu and project-tree menu) no longer
  return lowercased strings on macOS/Windows: case folding now happens only in
  comparison keys, never in paths stored, displayed, or copied.
- `workspacePaths.workspaceRelativePath`: containment is still decided on the
  case-folded comparison keys, but the returned slice now comes from the
  case-preserving normalized form, so the copied relative path keeps the real
  on-disk casing.
- `workspaceTraversal`: `normalizeWorkspaceRoot` now preserves casing (it feeds
  the traversal root and display forms); `relativePathFromRoot` compares
  case-insensitively but slices the case-preserving path, so picker/search
  relative paths keep their casing too.
- `workspaceFileCatalog`: entries keep the original casing in
  `absolutePath`/`relativePath`/`basename`/`directory`; only the dedup `key` is
  case-folded. Files opened via Quick Open / project search therefore store the
  real path on the document, which is what Copy Path copies. Watcher-driven
  incremental `create` adds take the raw watcher path so they keep casing as
  well; root-containment checks inside the catalog now fold both sides.
- `openFileGate.requestOpenPath` returns the original (un-folded) path for
  `redirected`/`existing` results, so recents and "Switched to…" notifications
  keep the real casing; `openActivePath` reports large-file
  `pending_confirm` paths without folding.
- Tests: casing-preservation cases added in `workspacePaths.test.ts`,
  `workspaceTraversal.test.ts`, and `workspaceFileCatalog.test.ts`.

## 2026-08-11 22:35 MSK — Stop project-tree refresh/expand after drag-drop move

- Dragging a file/folder to another folder in the project pane no longer makes
  the tree visibly re-render a second time and expand folders to the moved
  file's new location.
- `projectTreeController`: added a short freshness cooldown
  (`RELOAD_FRESH_COOLDOWN_MS = 500`). `reloadDirectories` now records each
  reloaded directory, and the debounced filesystem-change flush skips dirs
  reloaded within the cooldown — so the in-app move's own targeted reload
  absorbs the redundant ~400ms-later flush emitted by both the post-mutation
  notify and the OS file watcher. Genuinely external changes arriving later
  still reload normally.
- `appShellEffects`: exported `markActiveFileTreeExpandApplied` to seed the
  reveal-active-file effect's dedup key, so its next (debounced) run is a no-op.
- `appShellProjectTreeHandlers` / `AppShellHost`: after a successful drag-drop
  move, the handler seeds that dedup key with the (possibly relocated) active
  document's path, suppressing the auto-reveal expansion that would otherwise
  open folders down to the moved file. No-op when the active document was not
  relocated.
- Tests: added coverage for the cooldown-skip and post-cooldown reload in
  `projectTreeController.test.ts`, and for the suppress key in
  `appShellEffects.test.ts`.

## 2026-08-11 22:28 MSK — Restructure active ops into assignable phase plans

- Kept the product and architecture direction in a standalone
  `specs/ops/roadmap.md`.
- Replaced the six flat task documents with six numbered phase folders based on
  the milestone template: each folder now has a scope/decision `README.md`, an
  `execution-plan.md` index, dependencies, risks, and definition-of-done gates.
- Split implementation into 26 ordered execution plans sized as focused agent
  handoffs: 6 for the foundation and 4 for each later phase.
- Added stable `AS<phase>-<slice>-<task>` task ids, per-plan ownership
  boundaries, acceptance criteria, verification, and next-plan handoff gates.
- Updated the ops allowlist for recursive phase folders and corrected roadmap
  release/historical references to the new `01`–`06` numbering.

## 2026-08-11 22:10 MSK — Split and clean the specs archive

- Archived the previous changelog as
  `specs/archive/changelog-pre-08-26.md`; this file starts the new changelog.
- Rebuilt `specs/ops` around the unified Sessions roadmap only: `00` is the
  product/architecture overview and tasks `01`–`06` are numbered in required
  implementation order.
- Moved 49 completed legacy ops documents to `specs/archive/ops-done`.
- Moved 9 cancelled, superseded, or unscheduled ops documents to
  `specs/archive/ops-postponed`.
- Updated source-code references to completed phase-3.5 specs after their move.
- Narrowly allowlisted the new active ops files and the three new archive paths
  so the cleanup remains represented in version control.
- Removed 25 archived documents dated before 2026-06-01. Documents dated June
  2026 or later were retained.
