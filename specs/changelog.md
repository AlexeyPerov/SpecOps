# Changelog

## 2026-10-01 14:37 MSK — File symbols and compact folder chevrons

- Added 45 original SVG file symbols with 170 extension rules and filename
  overrides for documentation, Git files, configuration and build files.
  The set covers source code, media and game resources, including scenes,
  prefabs, materials, shaders, models, animation and metadata. Unknown types
  retain a generic file symbol. Colors adapt to light and dark appearance.
- Project tree folders now show a thin rotating chevron without a folder icon;
  files show a single colored symbol aligned with the folder chevrons. Empty
  folders reserve the same space without an expansion affordance. New-file
  draft symbols update as the filename is typed.
- Added classification and tree interaction coverage, including special-name
  priority, compound extensions, empty folders and draft extension changes.

## 2026-09-28 14:11 MSK — File catalog stays current for background workspaces

- Folders created in a workspace while another workspace was active never
  showed up under the project panel's `.md` filter (or in Quick Open) after
  switching back. The watcher covers every open workspace, but its events
  reached only the active workspace's file catalog, and returning to a
  workspace reuses its cached catalog without re-enumerating. Watcher events
  now go to every retained catalog; each ignores paths outside its own root.
- The project panel's Refresh button now rebuilds the file catalog as well as
  the tree, so a stale `.md` filter can be recovered by hand.

## 2026-09-27 12:08 MSK — `.md` filter keeps nested Markdown files

- The project panel's `.md` filter hid every folder whenever the workspace file
  list behind it had not been built yet, so only the Markdown files in the root
  stayed visible. The list is now reported as "unknown" until the first
  enumeration completes, and while it is unknown the filter keeps every folder
  (files are still narrowed to `.md`). Once the list is in, only folders with a
  Markdown file somewhere below them remain. Folder matching compares
  case-folded paths.
- Switching workspaces with the filter on now starts enumerating the new
  workspace as well; previously only toggling the button did.
- A watcher-driven catalog rebuild no longer cancels an enumeration that is
  still running. On a large or busy workspace a steady trickle of file events
  could restart it indefinitely, so the catalog (and with it the `.md` filter
  and Quick Open) never became ready. The rebuild now runs once, right after
  the current enumeration finishes.

## 2026-09-22 17:46 MSK — Draggable editor text column

- The blank strip between the line-number gutter and the first character is
  half of what the pane has spare around the centred text column, and it was
  fixed at whatever `--editor-text-max-width` said (1200px). Hovering a text
  editor now reveals a thin rule on the column's left edge; dragging it resizes
  the column, and because the column stays centred, one pixel of pointer travel
  moves the edge by one and changes the width by two. Double-clicking the rule
  hands the column back to the app default.
- The width is stored per document (`DocumentState.textColumnWidthPx`,
  alongside `scrollTop` and `markdownViewMode`), so each tab keeps its own and
  the value survives a session restore. `null` means "use the default".
- The drag is clamped: never below 240px, and never past the space the pane
  actually has (measured as the column plus both margins, so the gutter and the
  minimap are accounted for without querying them). At full width the handle
  stops flush with the gutter's right edge instead of straddling it, so it
  cannot eat clicks on the line numbers, and it is hidden entirely when an
  unwrapped long line has scrolled the column's edge behind the sticky gutter.

## 2026-09-22 17:06 MSK — Notepad rail card, Open in New Window, project-tree refresh fixes

- The expanded activity rail's Notepad card no longer prints a "Notepad"
  heading — the avatar icon already names it. Its labels start at the top of
  the rail, and it lists up to three of the most recently opened Notepad files
  (previously one) as a vertical list instead of a wrapped stat row. The card's
  64px minimum height is gone, so it grows with the list rather than reserving
  space for it.
- Added **Open in New Window** to the file-tab context menu. The file moves to a
  freshly created window rather than being duplicated: a path may be open in
  exactly one window (`openFileRegistry` owns that invariant, and two windows
  editing one buffer would race on save), so the source tab closes once the new
  window has adopted it. A dirty tab is prompted for first and a failed transfer
  leaves the tab in place. The entry is enabled only for Notepad tabs, matching
  the existing tab drag-out policy. `moveTabToNewWindow` now raises the new
  window again after the transfer completes, so it ends up in front with the
  file already open.
- Fixed the project panel not reflecting changes — neither the user's own moves,
  creates, renames and deletes nor external ones. `projectTreeController` mixed
  two path forms: `childrenByPath` / `expandedPaths` are keyed exactly as the
  tree rows are, but the reload paths keyed them by the case-folded comparison
  form. On macOS and Windows those differ for any path with an uppercase
  segment — with `/Users/...`, every path — so:
  - `directoriesToRefreshForChange` matched a folded parent against the raw
    expanded set, found nothing, and dropped the change;
  - `reloadDirectories` stored fresh listings under folded keys that no row
    reads, and rebuilt root rows from a folded root, re-spelling every row path;
  - `expandedAncestorPathsForFile` returned folded ancestors, so revealing the
    active file expanded folders the tree could not match.
  Each of these now folds only for comparison and keeps the tree's own spelling
  for tree state.
- `reloadDirectories` also drops the shared directory-listing cache for the
  directories it is about to re-read. Without that it re-read the very listing
  the change had invalidated, concluded nothing had moved, and — having marked
  those directories fresh — suppressed the watcher flush that would have
  corrected it.
- Expanding a folder whose children are already in memory now re-lists it
  quietly in the background and applies the result only if it differs. A
  collapsed folder is not covered by the focus/workspace-switch revalidation
  passes, so its cached children could be arbitrarily old.
- Tests: `projectTreeCaseFolding.test.ts` covers the four cases above with the
  platform mocked as case-insensitive (the default test platform is
  case-sensitive, which is why none of this was caught); tab-menu gating covered
  in `tabContextMenuActions.test.ts`.
- Verification: `npm run check`, all 3,423 Vitest tests, and `npm run build`.

## 2026-09-20 — Copy workspace root path

- Added **Copy Path** to the activity-rail workspace context menu. The action
  copies the selected workspace's root-folder path to the clipboard without
  switching the active workspace.

## 2026-09-20 — Hide Markdown view controls for empty and non-Markdown files

- The edit/split/preview control is now rendered only for non-empty Markdown
  documents. Empty Markdown documents stay in edit mode so typing the first
  character makes the view controls available, while non-Markdown tabs no
  longer expose Markdown-only actions.

## 2026-09-14 14:40 MSK — Live project-tree refresh, preview tabs, path git log

- The project tree now revalidates itself when the window regains focus, when a
  workspace is switched to, and when the panel is expanded again — not only on
  manual refresh and startup. `projectTreeController.revalidateProjectTree`
  re-lists the root plus the currently expanded folders with bounded
  concurrency, compares each listing against the one on screen, and applies (and
  publishes) only real differences, so an unchanged tree costs a few directory
  reads and zero re-renders. Passes are throttled (2 s), de-duplicated while one
  is in flight, skipped while the panel is collapsed, and skipped right after a
  cold load, which already read from disk. The shared directory cache is
  invalidated for exactly the directories a pass is about to re-read.
- Manual refresh no longer rebuilds the tree. It runs the same pass with
  `force`, so `childrenByPath` is never emptied — the rows, the expansion, and
  the scroll position all survive a refresh.
- The project panel no longer jumps after a delete, move, or refresh: the
  reveal-active-file effect now runs only when the active file actually changes
  (retrying across tree updates until its row exists) instead of on every tree
  publish, and a scroll offset the browser clamped away while the list was
  briefly shorter is restored.
- Project-pane spacing moved into `tokens.css` as `--project-tree-*` (padding,
  per-depth indent, row padding, icon gap, row height, row spacing). The indent
  went from 4px to 10px. `ProjectTreeView` reads the row height and row spacing
  back at runtime for its virtualization math, so those values can be retuned in
  one place with no code change.
- Single-clicking a file in the project tree now opens it as a **transient
  (preview) tab**, rendered in italics: the next single click reuses the slot and
  closes the previous preview instead of stacking tabs. A preview is promoted to
  an ordinary tab as soon as the user acts on the file — an edit, a user-driven
  caret or selection move, a double click on the row or the tab, dragging the
  tab, or reopening the file through an explicit route (Quick Open, a menu, a
  pane drop). A preview holding unsaved edits or a pin is promoted rather than
  closed, and tabs restored from a session snapshot are never transient.
- Added **Git Log…** to the project-tree context menu (files and folders) and
  the file-tab context menu. It opens a popup at the click point listing the
  commits that touch that path (subject, short sha, author, relative date) with
  "Load more"; picking a commit opens Version Control on it, including when that
  view is already mounted. `queryCommits` accepts `paths` (literal pathspecs)
  and `follow`, and the popup runs with the `versionControl` git scope because
  it is user-initiated.
- The editor text column now has flexible side margins: it is centred once the
  editor is wider than `--editor-text-max-width` (1200px) and hugs the gutter
  below that. Long lines still scroll horizontally, and `none` restores the
  previous always-left-aligned layout.
- Verification: `npm run check`, all 3,416 Vitest tests, and `npm run build`.

## 2026-09-13 21:47 MSK — Refine secondary windows, project files, search, and drag-drop

- Secondary windows now complete confirmed closes with a direct window teardown,
  avoiding the intercepted close-request loop that left individual windows open.
  A secondary window showing Notepad now keeps only the title area, tab strip,
  and editor; workspace rails, panels, Markdown controls, and the status/bottom
  area are omitted.
- CodeMirror selection styling now overrides its focused-selection rule, keeping
  selected text legible in dark themes. Markdown edit/split/preview controls are
  limited to actual Markdown documents and remain available for empty `.md`
  files, while no-document and non-Markdown views do not show them.
- Project search now preserves whitespace queries, cancels stale results when
  query options change, produces stable result ordering, reports unreadable or
  oversized skipped files, and prevents Replace All from acting on an obsolete
  result set. Project replacement now evaluates blocked directories relative to
  the workspace root rather than rejecting safe workspaces under dot-prefixed
  ancestor paths.
- Every project-tree context menu can start file or folder creation. The project
  header has a root-create `+` menu and the blank area below the tree opens the
  same root menu. Creation uses an in-tree, focused name placeholder: Enter
  commits to disk, while Escape or focus loss cancels without creating anything.
- Added a `.md` project-panel filter that loads the workspace catalog and shows
  only Markdown files plus their ancestor folders.
- Files from the project tree or the operating system can be dropped onto the
  Notepad or workspace rail icons to open/move the tab in that context. Chat
  contexts are deliberately excluded and valid targets show a hover affordance.
- Cleared the full type-check backlog in affected legacy tests and host API
  declarations. Stabilized platform-specific Git null-device handling and
  Markdown-outline reactive refreshes found by the full test run.
- Verification: `npm run check`, all 3,391 Vitest tests, and `npm run build`.

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
