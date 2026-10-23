# Changelog

## 2026-10-23 09:26 MSK — Add tab groups and app-wide Tasks and Notes to the sidebar

- Tab groups: the sidebar lists the window's tab groups above the workspaces, with a "+" to create one ("Tabs 2", "Tabs 3", … or a typed name) and a menu with Rename and Delete. The default group cannot be deleted. Expanded rows show the name, tab count and last three saved files; compact rows show the default group's icon or an initial. Deleting a group with unsaved buffers asks to Save all or, after a second confirmation, discard them, then releases the window's claims on its files. Deleting the active group activates the default group.
- Opening rules: files opened outside the active workspace, the Workspace Manager and files saved outside their workspace go to the active tab group, else the window's last used group, else the default group. Closing the last workspace activates that same group. Dragging a file tab onto a group row moves it with its unsaved buffer; a dirty buffer is not moved onto a copy of the same file already open there. File drops from disk or the project tree onto a group row open in that group.
- Tasks and Notes: the single app-wide Tasks and Notes buttons are replaced by "Tasks" and "Notes" sidebar sections that list any number of app-wide documents. Each section's "+" creates a document; its menu offers Open, Rename, Move Up, Move Down and Delete. A document opens as its own tab, named after it, in the target tab group. Delete asks for confirmation, removes the catalog entry, closes its tabs in every window and deletes its files.
- Storage: the project catalog stores app-wide documents (`id`, `kind`, `name`, per-kind `order`) through new put, rename, move and remove transactions; a catalog without documents loads as an empty list. Files live in `global-documents/<id>/` under the application data directory, with ids limited to letters, digits and hyphens. The removal transaction deletes the files after the catalog is written. The document service and view tabs are keyed by document id, so several documents of one kind can be open at once. The previous single `global-documents/tasks.json` and `notes.md` files are not read or migrated.
- Wording: tab-related messages and settings text say "tab group" instead of "Notepad". Closing view tabs when Git integration is turned off now also covers tab groups.
- Specs: `workspace-tools.md` describes tab groups and app-wide documents; `tab-groups-and-documents.md` marks all five phases done.
- Validation: new tests cover tab group creation, naming, rename, deletion rules, the target group, moving tabs between groups, the delete flow with save and discard, sidebar group rows and the name form, app-wide document creation, ordering, opening, deletion and cross-window pruning, document-scoped storage, the sidebar row selector and tab drops onto group rows; a native test covers catalog documents and file removal, and the native path test covers document ids. All 3387 frontend tests and 190 native library tests pass (1 ignored as before). Svelte/type checks report zero errors and warnings, and the production frontend build passes. The app was not run, so the sidebar sections, drag-and-drop onto group rows and the dialogs have not been checked visually.

## 2026-10-22 23:36 MSK — Replace the window Notepad context with a tab group list

- App state: each window keeps an ordered `tabGroups` list instead of a single `notepad` context snapshot. The default group (`tabs-default`, named "Tabs") is always first and is the window's fallback context: files opened outside the active workspace, the Workspace Manager, saved files moved out of a workspace and closing the last workspace all land in it, as Notepad did. Context lookups, patches, cross-context document search, tab transfers, session-tab cleanup, Git view gating and editor cache retention walk every tab group. `isNotepadActive` becomes `isTabGroupActive`, and the outside-path helpers and the workspace migration of an open file are renamed to match. There is still one group per window, so the sidebar and editor behave as before.
- Session: window snapshots, navigation records, per-document buffer files and the registry dedupe store `tabGroups`; restore keeps the stored order after the default group and recreates the default group if it is missing. Window snapshots in the previous format (with `notepad` and without `tabGroups`) are not restored, and no migration is provided, so the first launch after this change opens windows with a fresh default group.
- Specs: new `specs/tab-groups-and-documents.md` describes the plan to make tab groups, Tasks and Notes sidebar entities (per-window tab groups with an undeletable default group; app-wide Tasks and Notes documents) in five phases; this change is phase 1.
- Validation: all 3359 frontend tests pass, including new regressions for default-group ordering, restoring a missing default group, switching and editing a second group, and skipping previous-format snapshots. Svelte/type checks report zero errors and warnings. The app was not run.

## 2026-10-22 23:24 MSK — Flatten the sidebar workspace context menu

- Sidebar: right-clicking a workspace opens one flat menu again instead of a catalog menu with a nested "Workspace actions…" submenu. It combines the former workspace menu (Settings, Open in Separate Window, Move to Window…, Open/Create Tasks and Notes, Version Control, Copy Path, Close Workspace) with Hide from Sidebar. Projects not open in this window show Open Workspace, Version Control, Copy Path and Hide from Sidebar. The menu keeps arrow-key navigation, Escape, viewport clamping and tooltip suppression.
- Removed from the menus: Refresh Git status, Pin/Unpin, Move up/down, Move to folder, and Move folder up/down/to end. Workspaces and folders move between and within sections by drag and drop (Alt+Arrow still reorders a focused workspace). Each workspace row has a star button that pins or unpins it: filled when pinned, outlined when not (always shown in the expanded sidebar, on hover or when pinned in the compact one).
- Version Control: the toolbar has a visible Refresh Git status button. Refresh (from the toolbar or the overflow menu) also refreshes the workspace's sidebar Git status.
- Cleanup: the separate shell-rendered workspace menu, its overlay-host state and its move up/down and copy-path controller actions are removed; the sidebar menu calls the remaining workspace actions directly.
- Validation: updated sidebar, overlay-coordinator and workspace-action tests; new tests cover the flat menu items, the star toggle and the Version Control refresh button. Menu-based folder moves in tests now use drag and drop. The pre-existing `ActivityRail` Git-label test is fixed to read the row's accessible label. Svelte/type checks report zero errors and warnings. The full frontend suite passes except a `GitHistoryPanel` test and a chat-persistence integration test that timed out under full-suite load and pass on their own. The app was not run, so the menu, star and button have not been checked visually.

## 2026-10-22 22:52 MSK — Fix medium performance issues in files, Git and the editor

- Git: sort status, branch and tag lists with shared `Intl.Collator`s instead of per-comparison `localeCompare` options. Inline file diffs cap native stdout just above the 512 KB display limit, so an oversized diff (for example a large untracked file) is truncated in the native reader instead of buffered, sent over IPC and re-encoded in full; over-long strings are rejected without encoding a copy.
- Version Control: refreshing the Changes view for the same repository keeps the current rows listed (row actions wait for the refresh) instead of swapping the whole list for a loading state and rebuilding every row. History formats commit dates only for visible rows, cached by timestamp, instead of for every loaded commit on each reload.
- Editor: memoize Markdown outline headings per document text instead of per editor state, so caret moves no longer re-walk the syntax tree, and skip descending into paragraphs and tables. Transient-tab promotion on every caret move and keystroke checks a per-`contexts` set of preview documents before building the document lookup index. Session persistence reuses buffer fingerprints for unchanged documents (collapsed clean copies are now stable per document) instead of re-hashing every open buffer on each persist.
- Files: workspace enumeration for the file catalog keeps up to 8 directory listings in flight instead of reading one directory at a time. Content-only (`modify`) watcher events no longer reload project tree folders or invalidate cached listings. The directory cache bumps a listing's generation only while a read is in flight, so changed file paths no longer accumulate for the whole session. Find in Project checks literal queries against the whole file with the editor's regex flags before splitting it into lines, so files without a match are not copied into a line tree.
- Validation: new regressions cover the native stdout cap, kept Changes rows during refresh, stable collapsed session documents, concurrent enumeration with read errors and cancellation, and literal search parity (case folding, whole word, multi-line literals). All 189 native tests pass. Svelte/type checks report zero errors and warnings. The full frontend suite passes except the pre-existing `ActivityRail` Git-label test. The installed native app was not rebuilt or replaced.

## 2026-10-22 22:36 MSK — Fix performance hot spots in tabs, files, project pane and Git

- File catalog (Quick Open, Find in Project, `.md` filter): keep a key index next to the sorted entries, so watcher creates binary-insert instead of re-sorting the whole catalog and removals skip linear scans. Ignore `modify` events once the catalog is ready, and resolve `rename` events and rejected creates with a path stat instead of a full workspace re-enumeration. Previously every save (atomic rename) re-listed the whole workspace and dropped its cached directory listings; a stale stat cannot undo a later create or remove of the same path.
- File watcher: run the debouncer without the file-ID cache. Events are already emitted per path, and the cache stat'ed every created path and scanned its whole map on each removal, which was quadratic on mass deletes such as removing `node_modules`.
- Workspace Git summary: batch watcher invalidations into one call per 100 ms instead of one IPC per changed path, and skip re-broadcasting every summary row to every window when the entries were already waiting on their debounce.
- Git subprocesses: poll for exit with a backoff starting at 1 ms instead of a fixed 50 ms sleep, which added ~50 ms to every Git command and to each step of sequential chains.
- Version Control: stage, unstage and stage-all reload only the Changes status (and operation state) instead of also re-running history, the reference tree, the branch header and the remotes query. Stage and working-tree edits no longer drop the cached remotes.
- App state: skip store notifications when a mutator returns the same state, so no-op updates on keystrokes and caret moves (for example promoting an already-permanent tab) no longer re-run every selector and `$appState` reader. Open-document and watcher-key selectors return their previous output when `contexts` is unchanged, the settings-persistence effect depends on wrap/zoom values instead of the whole editor slice (caret moves), and the cache-retain effect depends on workspace identities instead of the whole state.
- Project panel: coalesce the favorites existence check after tree changes (500 ms) instead of re-reading the favorites file on every expand and watcher flush, and derive the Markdown filter's catalog path list only when the catalog changes.
- Validation: new regressions cover sorted incremental inserts, ignored modifies, stat-resolved renames/creates, directory renames, stale stats, remotes cache retention on stage and no-op store updates. All 95 focused native watcher/summary/Git tests pass; the full native suite passes except a component-manager test that passes on rerun. Svelte/type checks report zero errors and warnings. The full frontend suite passes except the pre-existing `ActivityRail` Git-label test (fails without this change too) and a `GitHistoryPanel` test that timed out under full-suite load and passes on its own. The installed native app was not rebuilt or replaced.

## 2026-10-22 22:06 MSK — Speed up project tree expand and collapse

- Reuse unchanged flattened tree rows between renders, so expanding or collapsing a folder only updates the rows it adds, removes or changes instead of re-rendering every visible row. Keep the project tree controller state as raw (non-proxied) state so root nodes keep their identity across publishes and their rows are reused too.
- Validation: in a component benchmark with 150 visible rows, a collapse drops from ~30 ms to ~2.5 ms, an expand from ~30 ms to ~5 ms, and a no-op tree update from ~33 ms to ~0.3 ms. A new flatten regression covers row reuse; all focused tree tests pass; Svelte/type checks report zero errors and warnings. The full suite passes except the pre-existing `ActivityRail` Git-label test, which also fails without this change. The installed native app was not rebuilt or replaced.

## 2026-10-22 17:26 MSK — Fix commit SHA button contrast

- Give the Copy SHA button an explicit theme surface and primary text color instead of combining a native button background with muted text. Add padding, rounded corners, hover/pressed borders and a keyboard focus ring.
- Validation: browser checks across all 43 built-in and preset themes in normal, hover, pressed and focus states pass with a minimum text contrast of 4.51:1. All 27 focused commit-detail and theme tests pass; Svelte/type checks report zero errors and warnings; Svelte autofixer reports no issues; production frontend build passes. The installed native app was not rebuilt or replaced.

## 2026-10-22 11:04 MSK — Remove transient workspace Git labels

- Hide Git check/cache status labels and refresh markers in workspace sidebar rows and the workspace manager. Preserve the last branch, tracking and working-tree summary through background refreshes and failures; leave rows without a summary blank. Keep diagnostic details in tooltips and accessible descriptions.
- Validation: all 16 focused presentation, sidebar and manager tests pass, including stable text/marks during refresh and errors in both sidebar widths. Svelte/type checks report zero errors and warnings; Svelte autofixer reports no issues; production frontend build passes. The installed native app was not rebuilt or replaced.

## 2026-10-21 18:43 MSK — Expand a workspace folder after its first incoming move

- After a successful sidebar context-menu or drag-and-drop move, expand the destination folder when the moved workspace is its only visible member. Count members without the search filter and persist expansion for the current window. Preserve collapse state for populated folders and failed moves.
- Validation: all 19 activity-rail component tests pass, covering both sidebar widths, menu and pointer moves, persisted expansion, occupied folders and save failure. Svelte/type checks have zero errors and warnings; Svelte autofixer reports no issues; production frontend and native app builds pass. Update the installed app with the new build.

## 2026-10-21 18:38 MSK — Remove build annotation and unused native resolver warnings

- Let Svelte compile type-only TypeScript directly instead of preprocessing component scripts with esbuild. This prevents misplaced pure annotations in removed effects and rewritten expressions, eliminating the Rollup annotation and associated sourcemap diagnostics while retaining style preprocessing.
- Remove the unused bundled-runtime path resolver and its module registration; native runtime launch already uses the component manager.
- Validation: production frontend build passes without annotation or sourcemap warnings; Svelte/type checks report zero errors and warnings; all 333 frontend test files / 3347 tests pass; native `cargo check --release` passes without warnings. The pre-existing frontend chunk-size advisory remains.

## 2026-10-21 18:25 MSK — Register restored workspaces before catalog organization

- Reproduce the folder-move failure in the installed native app: session-restored workspace rows were projected into the sidebar while the persistent catalog contained no projects, so both menu and drag operations failed with “Project is not registered”.
- Register every open workspace after session restoration and before runtime readiness. Register already-open paths when reopening them, and include missing live workspace registrations in the same sidebar transaction as organization actions, preserving existing catalog preferences and folder membership.
- Validation: all 333 frontend test files / 3347 tests pass; all 18 native catalog tests pass, including a real-filesystem sparse-catalog reproduction and atomic registration/move regression. Svelte/type checks have zero errors and warnings; production frontend and native app builds pass. In an isolated native app seeded with two session workspaces and an empty project catalog, verify automatic registration, a context-menu move, a pointer-drag move and persisted destination membership after relaunch, without mocked catalog I/O. Update the installed SpecOps app and verify real menu and drag moves there as well; restore the checked workspace to its original folder afterward.

## 2026-10-21 13:58 MSK — Fix workspace folder moves and lazy Tasks/Notes editing

- Make Move to folder in the sidebar and workspace-manager batch actions unpin selected projects, matching drag-and-drop so moved projects appear in the destination folder. Retain the captured workspace row throughout a drag and resolve drops from pointer-release coordinates.
- Rename the shared sidebar links and document headings to Tasks and Notes. Open missing documents as an editable empty task book or Markdown editor, creating files only after the first committed change. Keep unsubmitted drafts through background refreshes and the notes editor mounted after the first input; viewing or saving an untouched empty document creates no file.
- Validation: all 333 frontend test files / 3345 tests pass, including regressions for both sidebar widths, collapsed-folder drops, release coordinates, first edits and lazy storage. Svelte/type checks report zero errors and warnings; production frontend build passes. Browser component acceptance confirms context-menu and pointer-drag moves with catalog I/O stubbed; the installed native app was not rebuilt or replaced.

## 2026-10-21 13:39 MSK — Restore project context-menu creation

- Activate New File and New Folder on click, closing the menu before opening the inline name field. Avoid starting a draft during pointer-down focus handling and support ordinary button activation.
- Add component regressions for both creation actions, checking menu dismissal, input focus, the destination path and Enter submission.
- Validation: 23 focused component/file-operation tests pass; Svelte/type checks report zero errors and warnings, and the production frontend build passes. Browser component acceptance confirms both name fields receive focus and submit to the requested parent; filesystem callbacks were stubbed for this UI check. Reproduced the missing name field in the installed desktop app before the fix; the installed bundle has not been replaced.

## 2026-10-21 09:35 MSK — Make project tree auto-refresh reliable

- Bound filesystem-event batching to one second under continuous writes. Keep notifications arriving during reads for a followup pass, replace the freshness cooldown with listing comparisons, and avoid republishing unchanged roots and children.
- Coalesce focus/workspace checks into a trailing revalidation instead of dropping throttled or overlapping requests. Revalidate empty roots, discard older directory results, preserve loading-state completion, and release deferred work when switching or closing workspaces.
- Retry temporary directory-read failures with bounded backoff and skip removed directory branches. Serialize native tree-watch registration, retry partial registration failures with exponential backoff, and reconcile after successful registration to cover startup gaps.
- Validate canonical and registered event paths against their respective roots so symlinked projects receive events. Recover native watchers after errors or rescan requests while retaining document/tree registrations from every window. Extend watcher diagnostics with requested/registered roots, last error, event/sync timestamps and recovery state; expose tree read/error/pending-work diagnostics.
- Validation: 333 frontend files / 3336 passing tests, including continuous-event, followup-read, cooldown, empty-root, throttle, stale-result, workspace-lifecycle and loading-state regressions. Full native library suite passes 187 tests with one existing ignored probe; the final focused watcher suite passes 17 tests, including an additional real filesystem event through a symlinked root. Svelte/type checks and production frontend build pass. The Svelte autofixer reports an existing false positive for the derived readable Git-status store. Native desktop UI acceptance was not run.

## 2026-10-18 23:49 MSK — Fix Git review findings across native runner, askpass, parsers and panels

- Native runner: a Cancel that races command completion no longer reports a finished commit/push as cancelled, and an exited child is never signalled (PID reuse). `index.lock` is removed only when our own child had to be killed outright; the stale-lock recovery command keeps locks younger than five minutes (returns Busy) and resolves the Git directory of linked worktrees and submodules. Abbreviated long options (`--upload-p=`, `--templ=`) and stuck/clustered `ls-remote -u` forms are rejected. A blocked output reader loses only its own stream instead of the exit code. Git children get no stdin, drop inherited `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`/config-injection variables, and run with colour, diff-prefix and log-signature config pinned so user settings cannot change parsed output. `branch --show-current` is a read on both sides. Output cut at the size cap no longer ends in a broken character. The Unix-only import is gated so the module builds on Windows.
- Credential prompts: Cancel and answer timeouts write a marker that makes the helper exit at once instead of keeping Git hung for two minutes; answers are published atomically (0600 temp file + rename) and each request accepts one answer. Waiting for Git's next prompt has no deadline; only the user's answer is timed, and the dialog closes itself after the timeout. OpenSSH now receives `SSH_ASKPASS_REQUIRE=force`. Username hints come from URL userinfo or `user@host's password:` prompts, password fields are never prefilled, and secrets are sent untrimmed. A resolved request closes the dialog in every window. Session ids include a counter.
- Workspace Git summaries: Refresh during an in-flight read schedules a new read instead of returning the older result, an inactive-window rejection is not cached as an error, and coordinator locks recover from poisoning.
- Parsers: `branch -vv` no longer reads `[TICKET-1]`/`(…` subjects as upstream or worktree paths or drops such branches; an unborn branch with an upstream parses its name; quoted paths decode `\a \b \f \v`; name-status paths keep significant spaces; only rename/copy porcelain rows split on ` -> `; `diff --git` headers with spaces split symmetrically and use `rename/copy from/to`; two-line mode changes are read; commit file diffs of renamed files pass both paths; ref names reject empty, dot-leading and `.lock` components; the diagnostic sanitizer redacts token-only URLs, auth header credentials and prefixed `*_token`/`*_secret` keys.
- Services: conflicts printed on stdout are detected for pull and stash apply/pop, and a conflicted pull sends the user to Changes instead of a generic failure; `createStash` on a clean tree reports nothing to save instead of returning an older stash; stash drop re-resolves the entry by SHA; filesystem permission and lock errors are no longer reported as authentication failures; ahead/behind treats a gone upstream or detached HEAD as no upstream; "not a repository" is cached for five seconds; remote-list cache invalidation is synchronous and discards stale in-flight results; an aborted queued read no longer frees a slot it never took; the derived push target pushes `HEAD` to the remote branch.
- Panels: clicking a file in Changes no longer reloads status or clears checkbox selection, focus is not pulled back to the commit message on reloads, and Space/Enter toggle row checkboxes. Check remote in Tags keeps the user's selection and discards results from an older list, Create/Delete wait for remote operations, and messages use the tag captured at start. The push dialog does not re-query the remote after a push, the log popover drops duplicate commits when loading more, duplicate autosave failure labels no longer crash the prompt, and out-of-range commit timestamps no longer break History.
- Not changed: process-group termination of hook/ssh grandchildren, routing credential prompts to the requesting window only, respecting a user `core.sshCommand` in askpass operations, cancel requests that arrive before the command is registered, and structured branch listing for the remaining `branch -vv` ambiguities.
- Validation: 331 frontend files / 3317 passing tests, Svelte check with zero errors and warnings, and 184 passing native library tests with one existing ignored probe, including new tests for each fix and real-Git integration tests for stash/upstream/push edge states. Production build and native desktop acceptance were not rerun.

## 2026-10-18 23:15 MSK — Fix review findings in workspace close, catalog and Git summaries

- Window close no longer gets stuck: a failed project-catalog checkpoint (for example a damaged catalog without a valid backup) asks whether to close anyway instead of always vetoing, and a contexts change during the flush retries the flush (up to three passes) instead of failing at once. A failed session flush still keeps the window open.
- Checkpoint all open projects in one catalog transaction. Coalesce workspace recency (`lastUsedAt`) updates into one delayed batch that skips removed projects and is flushed before checkpoints. The native catalog no longer rewrites files, bumps the revision or broadcasts a change for no-op mutation batches.
- Share one deeply frozen committed catalog snapshot instead of deep-cloning it on every read. Restored documents get mutable copies of saved metadata.
- Run Git summary sync/refresh/invalidate/complete/release/detach and window teardown on the blocking pool instead of the main thread. Resolve repository layouts outside the coordinator lock, including the debounced re-discovery. Ignore summary syncs from already destroyed windows so they cannot leave demands and metadata watches behind. Match invalidation paths after resolving symlinks and case through the deepest existing ancestor, so edits under symlinked roots refresh summaries.
- Remove the redundant pre-queue pull snapshot check; the check inside the mutation lane remains. Keep Git view-state eviction in least-recently-used order.
- Validation: 323 frontend files / 3250 passing tests, Svelte check with zero errors and warnings, and all native library tests passing, including new tests for no-op catalog transactions, symlinked invalidation paths, close retry/confirm, batched recency and view-state eviction. Native desktop acceptance was not rerun.

## 2026-10-18 20:13 MSK — Add global documents and grouped task books

- Add Global Tasks and Global Notes beside Notepad in both sidebar widths. Open singleton document views without a workspace and share global contents across windows; keep creation explicit and workspace documents independent.
- Replace flat Markdown tasks with a validated version-1 JSON task book containing stable group/list/task IDs. Support names/text, completion, one level of groups, ungrouped lists, manual order, list/task moves, list search and completion filters, last-deletion undo, and copying the complete book as Markdown. Removing a group keeps its lists; removing a list removes only its tasks. Notes retain editable Markdown and sanitized preview.
- Store workspace documents in application data by default or `.specops/tasks.json` and `.specops/notes.md`; global documents always use their own application-data directory. Preserve atomic compare-before-write saves, explicit current-format storage transfers and close-time flushes. Do not migrate previous filenames or Markdown task data.
- Publish native save events to refresh cached copies across windows, reread external changes on focus/Refresh, retain dirty contents on conflicts/read failures, reject invalid task JSON before publication, and guard late reads against newer saves. Keep task selection/drafts through background rereads, reset view state on storage changes, and respect blocked context switches when opening global tabs.
- Track and update the workspace-tools behavior/JSON-format documentation and README. Validation: 322 frontend files / 3247 passing tests, Svelte/type checks with zero errors and warnings, successful production frontend build, and 162 passing native library tests with one existing ignored probe. Browser component acceptance covers create/complete/delete/undo and light/dark narrow layouts without horizontal overflow; full native-window UI acceptance was not rerun for this change.

## 2026-10-18 19:55 MSK — Validate the 30-project workspace lifecycle (WS-08)

- Add reproducible disposable fixtures, isolated profile seeders, portable native evidence helpers, screenshots and raw before/after measurements in `specs/workspaces-evidence`. Preserve original/instrumented baseline provenance, failed/contaminated runs, exact sample counts, machine/build context and measurement limits.
- Bound the rail's flex height so offscreen catalog rows do not request Git. Retain passive narrow metadata watches while blurred, pause subprocess scheduling and refresh invalidated fresh entries on focus. Count actual native Git child creation and guarded summary lifetimes/peaks with parallel-safe tests.
- Fix populated-chat close revision checks, concurrent same-root restored opens/ownership rollback, dirty recovery surviving large-file gates, recreated-file missing/BOM metadata, Save all edits during close awaits and transferred preview-cache release. Await file-claim release before window destruction; canceled/failed cleanup keeps the window and restart entry usable.
- Reuse immutable Git presentations and a shared time formatter after measured native WebKit render costs. Matched idle pointer runs 2+3 meet the scoped target: p95 31→33 ms, 88 transitions each (+6.45%); all three runs and the baseline first-focus timeout remain in the report. This measures release→two frames for five Untitled contexts, not heavy document restore.
- Native checks cover 30 closed/5 open/30 open records, two windows/owner focus/file reuse, restart/reread, Cancel/Discard, ten close/reopen cycles, external checkout while blurred within TTL, 301 filesystem writes and bounded rail/Manager geometry at multiple widths/125% scale. Search p95 is 23 ms over 40 correct results with zero added Git children after warming; shared guarded peak is four. Startup and one native RSS sample increased; record limits and the existing isolated-profile favorites capability error.
- Validation: 322 frontend files / 3230 passing tests with four workers, Svelte/types 0 errors and warnings, production frontend/native debug bundle, 159 passing serial native library tests and one existing ignored probe. Preserve an earlier unconstrained run's two unrelated timing failures and the subsequent complete passing run; rail Svelte autofixer has no issues.

## 2026-10-18 18:35 MSK — Manage the full project catalog and release closed contexts (WS-07)

- Add Manager scopes for all/current-window/other-window/closed/hidden projects, search and name/recent/manual sorting, folder/pinning/open-state columns, checkbox/modifier/range selection and semantic atomic folder/pin/visibility batches. Show individual failures and successful counts without activating selected projects; retain the shared visible-row Git service.
- Separate workspace close from closed-only catalog removal. Serialize ownership claims and guarded removal under the native catalog lock, checking current live windows after acquiring the lock. Preserve files, notes/tasks and session history; reopen catalog entries without choosing their directory again.
- Save lightweight tab/layout/document metadata without file buffers in catalog caches or subscriptions. Reread ordinary files on reopen and retain unavailable roots/files. Persist untitled drafts and window-close unsaved recovery in immutable content-addressed sidecars before publishing their catalog references; keep current/backup references during cleanup and never revive explicitly discarded buffers.
- Guard close with Save/Discard/Cancel, awaited document/chat/session checkpoints, concurrent edits/activity, running sessions/native Git writes and transfers. Restore only the failed-close context after an ownership-release failure, preserving concurrent edits and focus in other contexts; failed window-session flush cancels closing. Checkpoint secondary-window projects before removing their restart entry; retain the existing transfer protocol and running-turn behavior.
- Release closed contexts' editor/chat/document/preview/tree/directory/catalog caches and timers; prevent late loads or editor teardown from repopulating them. Aggregate native file/tree watches per window and release only a destroyed window's contribution. Add asynchronous on-demand watcher diagnostics and retain running Git subprocess accounting while evicting unused summaries.
- Validation: 322 frontend files / 3218 tests, zero Svelte/type diagnostics, production build, 155 passing native library tests with serial execution (one existing ignored; a parallel Agent Host lease test reported Busy once and passed in isolation), including watcher registration/release, concurrent owner/remove and new-window liveness races, recovery integrity, flush failures, Notepad Save all and mixed-tab restore. Manager Svelte autofixer reports no issues; its route warning about the existing derived readable Git store is a false positive. Native desktop acceptance and measured resource cycles remain in WS-08.

## 2026-10-18 18:13 MSK — Show demand-driven Git summaries in the workspace rail (WS-06)

- Observe actual row intersections inside the sidebar scroll viewport and retain a separate active-root subscription, including hidden or collapsed projects. Collapse/filter/removal release row demand and local snapshots; width changes preserve subscriptions and shared TTL/coalescing. The existing service owns focus, background-settings, invalidation and app-wide queue gates.
- Render branch, nonzero local ahead/behind, dirty/conflict markers and explicit unknown/loading/fresh/stale/not-Git/error states in expanded rows and narrow accessible icons. Preserve previous summaries during checks and failures; explain locally known upstream refs, no fetch, tracking errors and successful-check time in tooltips. Share presentation with the Manager.
- Add separate Version Control actions, single-row refresh and visible-row refresh without ordinary row activation. Verify explicit Manager refresh includes only its filtered roots in the same queue. Clean up unused view snapshots and ignore late observer callbacks after teardown.
- Validation: 319 frontend files / 3194 tests, including 30-row cold demand, scroll/collapse/filter, hidden active roots, resize stability, both widths and independent Git actions; zero Svelte/type diagnostics and a successful production build. Fourteen native service tests also pass, covering TTL, invalidation, deduplication and process lifetime; service tests verify focus/settings gates. Real desktop screenshots and performance measurements remain in WS-08.

## 2026-10-18 18:06 MSK — Share workspace Git summaries across windows (WS-05)

- Replace the Manager's batch/cache with demand subscriptions and publish each row independently. Share 60-second snapshots with explicit unknown/loading/fresh/stale/not-Git/error states, successful-check timestamps, conflict markers, force single-flight and preserved previous data after failures.
- Coordinate four app-wide summary leases with active/visible priorities and canonical worktree identities. Resolution and compact status use the existing Git APIs, per-repository queues and native runner. Attach accounting to the blocking runner until subprocess completion/reap, retain occupied slots across unsubscribe/window destruction, reject revoked tokens, and reclaim old webview lifetimes safely.
- Debounce invalidations for 350 ms, discard superseded generations and schedule one followup. Guard cross-window publications against reordered IPC responses; bound unused summaries and root resolutions. Gate background demand by settings, focus and visibility, settle refresh waits when consumers deactivate, and expose resource diagnostics.
- Watch only demanded worktree markers and Git metadata, resolve `.git` files/common refs for linked trees, ignore transient lock/access noise, and release watchers when demand disappears. Existing filesystem and Git mutation events invalidate affected summaries without fetch or full-catalog polling.
- Validation: 317 frontend files / 3186 tests, zero Svelte/type diagnostics, production build, 14 native coordinator/watcher/lifetime tests and 48 existing native Git runner tests. Include real HEAD/ref notifications, read-only status without self-invalidation, and accounting after an async caller disappears. Full desktop two-window/30-project measurement remains in WS-08.

## 2026-10-18 17:50 MSK — Search and switch workspaces (WS-04)

- Share catalog-only fuzzy name/path search across the sidebar, Manager and a lazy workspace switcher. Sidebar filtering temporarily reveals collapsed folders, disables ambiguous reorder, supports both widths and restores saved collapse on Escape. Search itself performs no filesystem traversal or Git requests; Manager filtering retains its stable existing Git membership until the shared Git service stage.
- Include hidden, closed and other-window projects in the switcher with folder and opening state. Rank by relevance before last use, preserve keyboard navigation/Enter/Escape and restore focus through the existing picker shell. Reuse the established opening and owner-focus flow, retaining inaccessible projects with errors and clearing recovered path errors.
- Track successful window-local project activations and persist catalog recency. Defer new/received context history until ownership commit, restore prior activation after failed claims, record real close successors, and exclude the Manager's Notepad transition. Previous Workspace skips closed, moved and inaccessible contexts; navigation activates the existing workspace lifecycle gate.
- Register Switch Workspace (Cmd/Ctrl+Alt+P) and Previous Workspace (Cmd/Ctrl+Alt+Left) in the registry, native menu and palette after checking default conflicts on both platforms. Validate focused navigation/search/overlay/access/rollback cases and the full frontend suite (316 files / 3176 tests), zero Svelte/type diagnostics and a successful production build. Svelte autofixer reports no issues; real desktop multiwindow acceptance remains in WS-08.

## 2026-10-18 17:41 MSK — Organize workspace folders and pinned projects (WS-03)

- Build sidebar sections from the shared catalog: pinned first without duplicates, hidden entries override pinning, current-window contexts and available closed projects are visible, and projects owned by another live window remain outside the sidebar. Refresh ownership in bulk after committed changes and window lifecycle/focus events; ignore stale crash placements.
- Add folder creation, rename, deletion, ordering, collapse and actual visible project counts. Remember collapse/scroll separately per window, preserve saved collapse while filtering temporarily reveals matches, and expose collapsed narrow sections through menus with full project names.
- Support project drag moves within/between folders and into pinned, native folder drag ordering, keyboard menus and Alt+Arrow alternatives. Disable ambiguous ordering during filtering/automatic sorting. Keep project paths/window ownership unchanged; pinning remembers folder position, assigning folders preserves pinning, and deleting a folder appends its projects to unfiled in relative order.
- Apply semantic native ordering transactions under the catalog lock so hidden entries and concurrent changes survive; update existing workspace context actions to use the same catalog order. Validation: 52 focused frontend tests, 11 native catalog tests including concurrent moves and folder deletion, zero Svelte/type diagnostics and a successful production build. Svelte autofixer reports no issues; real desktop multiwindow acceptance remains in WS-08.

## 2026-10-18 17:31 MSK — Compact workspace rows and project appearance (WS-02)

- Replace expanded workspace cards with 46px rows containing a name, a short distinguishing parent path for matching names, and a Git placeholder that starts no queries. Keep full paths and optional Sessions/Tabs counts in tooltips; retain scrolling, width resizing, narrow mode, file-drop targets, context actions and pointer reordering.
- Store optional project colors and symbols in the shared catalog, expose them in workspace settings, and render them in both sidebar widths while preserving textual accessible names. Failed writes display an error and retain saved appearance.
- Restore native keyboard activation with multiple projects, add explicit focus, keyboard context actions, Alt+Arrow ordering and keyboard width adjustment. Validate 30-row rendering, appearance persistence/errors, pointer selection/reordering and layout preferences: 34 focused tests pass; Svelte/type checks report zero diagnostics; production build passes. Native visual acceptance and interface-scale screenshots remain scheduled for WS-08.

## 2026-10-18 17:25 MSK — Persist the shared project catalog (WS-01)

- Add project/folder identities separate from window context ids, shared order/pinning/visibility/document-storage/appearance preferences, and a saved-context model/API. Persist the current format directly; previous preference files are not migrated.
- Serialize native read/modify/write transactions with an OS advisory lock, fsync and atomic replacement, preserve a validated backup, and recover it with a newer revision and cross-window notification. Lock/write errors never fall back to unlocked or truncating writes; subscribers observe committed snapshots and ignore stale replies.
- Register single/bulk workspace additions through the existing open path, retain unavailable registered projects with explanatory errors, roll back failed context claims, and focus the winning owner on concurrent opens. Manager lists the catalog alongside live contexts and opens closed entries by root.
- Validation: all 309 frontend test files / 3139 tests pass; 8 native catalog tests cover concurrent writers, normalized duplicates, lock/write failures, invalid transactions, backup recovery and preference/context round trips. Svelte/type checks report zero errors and warnings; production build passes. Full saved-context restoration and catalog controls remain in WS-07.

## 2026-10-18 17:11 MSK — Plan workspace organization and navigation

- Added an eight-stage plan for a persistent project catalog, compact workspace rows, folders, pinning, search and quick switching, shared Git summaries, catalog management and releasing closed-context resources. Agent activity indicators are outside the scope.
- Defined cross-window ownership and preference rules, bounded background Git refresh, acceptance criteria and a 30-project performance comparison. Allowlisted the plan for version control; application behavior is unchanged.

## 2026-10-18 16:49 MSK — Open the local macOS installer once

- Build local macOS bundles with Finder-based DMG decoration disabled so packaging does not show a temporary installer window. Keep opening the completed DMG once after a successful build. Local DMGs use the default Finder layout rather than custom icon positioning/background; published release builds are unchanged.
- Extend release-helper coverage to check the packaging environment even when inherited variables request Finder decoration, and assert one mount when the same installer is reported on both output streams. All 7 release-helper tests pass; an actual local build succeeds, skips temporary Finder decoration, and mounts the finished installer.

## 2026-10-18 16:37 MSK — Refine pending-file inspection and compact note windows

- Show the uncommitted history row only when the working tree has staged, unstaged, or untracked files. Select it in place to inspect staged/unstaged lists and the live diff below history; retain the draft and diff selection, hide the commit form in this inspector, preserve pending selection on refresh, and return to commit inspection when clean. Rename workspace navigation to File Status and align related action/help copy.
- Hide the entire Sessions panel, including its collapsed strip, until an active verified agent component has an authenticated account profile. Observe component/profile changes and window focus, reject stale results, and avoid starting the host on a fresh installation.
- Open blank secondary windows as portrait notes occupying about 15% of the current monitor work area, independently of parent size/maximization. Retain explicit restored bounds and tab-transfer sizing. Remove empty tab headers, redundant note-window title chrome and editor borders, and the blank minimap column.
- Validation: full frontend suite passes 307 files / 3124 tests; final focused regressions pass 43 tests, including an additional pending-selection refresh case. Svelte/type checks and production frontend/host/native app build pass. Native checks in an isolated profile confirm compact notes without empty chrome, no Sessions panel for an unconfigured workspace, inline pending-file lists/diff, and removal of the row after a real repository becomes clean.

## 2026-10-17 20:09 MSK — Accept Git workspace layout and remote dialogs

- Complete native desktop acceptance at four CSS viewport sizes, light/dark palettes and increased interface size; record dated History, Changes, Pull, Push, empty/detached/bare/offline and secondary-window evidence with honest runner-only authentication coverage.
- Correct narrow toolbar/sidebar/diff sizing, history border tokens and Push group legend wrapping. Resolve real bare repositories without issuing worktree-only stash/recovery/Changes queries, and remove synthetic detached-head branch rows.
- Retain runtime Git view state by workspace and window across shell remounts: selected commit, loaded depth/scroll, inspector file, Changes draft/diff, navigation collapse/filter/focus and sidebar visibility. Bound the cache, reread Git data, reconcile stale selection, guard late callbacks and successful commits after unmount, and make repeated history/ref navigation idempotent. No persisted-data migration.
- Validate 306 frontend test files / 3114 tests, Svelte check with zero diagnostics, production frontend/host build and native app bundle. Full serial native suite passes 122 tests with 1 ignored; initial parallel unrelated filesystem Busy failure documented. Compare actual pre-layout/current native performance with 5000 commits, including full SVG limits and small-sample caveats, in the acceptance evidence.

## 2026-10-17 19:16 MSK — Add explicit multi-branch Push plans

- Replace the Push shell with configured remote and redacted push URL, branch selection/destination/independent Track table, upstream hints, Select all, explicit tags-only/all-tags selection, validation, loading/auth/error states, progress, cancellation and per-ref results.
- Capture exact branch/tag object IDs, validate source/destination refs and duplicate targets, and recheck sources inside the mutation queue immediately before spawn. Send explicit SHA refspecs with implicit follow-tags disabled; never substitute HEAD, force, delete, or automatically retry a network push.
- Parse independent per-ref success/rejection/unknown outcomes and retain partial results. Configure only successfully pushed branches with Track selected using narrowly validated local branch tracking config; stop remaining tracking configuration on interruption and expose incomplete tracking. Refresh actual branch/tracking/remote state after failures and cancellation without claiming server rollback or atomicity.
- Preserve save preflight, authentication, cancellation registration at process start, workspace/generation guards and repository refresh. Read push endpoint hints from configured push URLs, including local paths with spaces.
- Validation: typed API, mounted dialog/pipeline and local bare-remote integration tests cover branch/tag combinations, renamed targets, Track on/off, stale sources, non-fast-forward, partial results and cancellation. Native contract/runner tests include actual push and process cancellation at a temporary bare remote. Svelte/type checks pass. Real network credentials and desktop visual acceptance remain pending GL-08.

## 2026-10-17 19:08 MSK — Add Pull options and recoverable Git operations

- Replace the Pull confirmation with a modal for configured remotes, redacted URL, authenticated remote heads and Refresh, immutable local target, explicit merge/rebase options, progress and process cancellation. Custom URLs remain unavailable with an explanation.
- Check the HEAD/branch snapshot after editor preflight and again inside the mutation queue immediately before every subprocess attempt. Reject stale workspace continuations; publish cancellation only once the runner starts the command.
- Recover pending merge/rebase from real Git state, including linked worktrees, after remount and after success/failure/cancellation. Continue/Abort use the existing save guard, queue, runner and refresh pipeline with constrained native recovery argv and no external editor. Preserve autostash while an operation is unfinished and open Changes for resolution.
- Add native read-only support for the navigation tree remote-ref query. Keep recovery status outside the independently sized content area so it cannot clip the Changes form or inspector.
- Validation: mounted modal/pipeline tests, temporary local Git remotes covering merge/rebase/fast-forward/no-commit/log/conflicts/recovery/worktrees, queued HEAD-change regression, native runner tests and Svelte/type checks. Real network credentials and desktop visual acceptance remain outside this pass; the latter is scheduled in GL-08.

## 2026-10-17 18:56 MSK — Add Git toolbar and persistent Changes workspace

- Expose Commit, Pull, Push, Fetch, Branch, Merge and Stash with responsive secondary actions, keyboard overflow, supported web remote/folder/settings utilities, and an explanation for unavailable Merge. No platform terminal command is available, so no terminal action is exposed.
- Commit opens Changes and focuses its message. Keep the draft and valid selected diff mounted across History/Changes navigation; place staging lists and commit form together on the left of the diff.
- Pull and Push open confirmation shells using existing supported targets and default options. Full target/options dialogs remain dependencies of the next two execution plans; visual acceptance remains pending.
- Capture repository/workspace identity before remote awaits, reject stale preflight continuations, and refresh actual repository state after started operations succeed, fail or cancel. Retain existing Git queue, save/auth guards, and cancellation; block toolbar operations during staging/commit and Changes mutations during remote operations.
- Validation: mounted toolbar/navigation/draft/focus, staging/commit guard, duplicate launch, failed-operation refresh, cancellation and workspace-switch tests; existing tree/history/selection/remote/refresh tests and Svelte/type checks pass.

## 2026-10-17 18:50 MSK — Complete Git commit inspection controls

- Extract reusable changed-file and metadata panes. Add path sorting, flat/tree presentation, rename-aware filtering, full-path tooltips, SHA copy, parent navigation through repository-wide history resolution and refreshed selected-row refs.
- Add search across the loaded unified diff with match navigation into virtual rows and working copy-path/displayed-diff actions. Label deleted files and merge first-parent comparisons; keep adjacent panes mounted for loading, empty, binary, size-limit and error states.
- Preserve valid selected files on refresh and reject late commit/file/repository successes and failures. Remove the unavailable external-tool suggestion from the size-limit message; no reverse-hunk or partial-stage mutation is exposed.
- Validation: 141 targeted mounted, splitter and Git API tests pass, including deferred selection races, refresh metadata, clipboard actions and virtual diff search; Svelte/type checks report no errors or warnings. Desktop visual and long-content scroll acceptance remains scheduled for final verification.

## 2026-10-17 18:44 MSK — Add compact Git history table

- Show Graph, Description, Commit, Author and Date in resizable columns with sticky headers, leading ref badges and whole-row selection. Keep one scroll container, fixed-height row virtualization and consistent SVG merge geometry in both density modes.
- Add explicit backend history order and optional remote refs, repository-wide SHA/ref resolution through the existing Git runner, parent/ref navigation, keyboard selection and SHA copy. Jump can open ancestry outside loaded pages; uncommitted changes opens Changes without a fake SHA.
- Preserve loaded depth, selection and scroll during refresh; clear missing selections and reject stale repository/ref/page/Jump responses. State the 5000-commit limit and bounded full SVG explicitly.
- Validation: mounted table and graph tests cover selection, keyboard, resize, density, pagination to 5000, refresh and stale responses; Git service/API tests and Svelte/type checks pass. Desktop visual acceptance remains scheduled for final verification.

## 2026-10-17 18:36 MSK — Add persistent Git repository navigation

- Show Workspace, hierarchical branches and tags, local remote-tracking refs and stable stash entries together in the sidebar. Mark the current branch, symbolic remote HEAD and available upstream tracking; keep full names in tooltips and a filter at the bottom.
- Add roving keyboard focus and filter expansion that restores user choices when cleared. Preserve valid reference selection on refresh, explain deleted selections and discard late responses from earlier repositories.
- Reference selection reads history without checkout. Reuse the existing guarded branch, tag and stash operations through compact context action forms; unsupported commit search explains its unavailable state. Add a reusable revision option to history queries and pagination through the existing Git runner.
- Validation: model and mounted tree/history/refresh tests plus existing Git guard and refresh tests pass; Svelte/type checks have no errors or warnings. Desktop visual acceptance remains scheduled for final verification.

## 2026-10-17 18:28 MSK — Add adjustable Git workspace layout

- Place history above the commit inspector at every window width. Keep navigation beside the workspace and arrange changed files above commit metadata, with diff in the right column; retain existing data loading and repository states.
- Add four accessible, keyboard- and pointer-adjustable splitters with minimum sizes, default reset, drag cancellation and focus indicators. Persist proportions per workspace and window, clamp restored sizes to the available area and allow navigation and metadata to collapse.
- Validation: mounted layout, resize, persistence, keyboard and pointer lifecycle tests plus existing diff tests pass; Svelte/type checks report no errors or warnings. Real desktop viewport screenshots and restart acceptance remain scheduled for the final verification task.

## 2026-10-17 18:17 MSK — Plan Git workspace layout and remote dialogs

- Added a scoped layout specification with eight ordered tasks, dependencies, acceptance criteria and current-source boundaries for navigation, history, commit inspection, toolbar, Changes, Pull and Push.
- Preserved four user-provided original PNG references, allowlisted the specification directory for tracking and documented the required Git API work separately from UI acceptance. Application behavior is unchanged.
- Validation: checked local Markdown links and byte-for-byte screenshot copies; implementation checks are deferred to the planned tasks.

## 2026-10-11 08:33 MSK — Move workspaces between window groups without restarting native turns

- Added Open in Separate Window and Move to Window actions to workspace context menus. Move whole workspace state, preserve dirty buffers/pane selections/session references, allocate destination-safe editor ids and update open-file claims.
- Added prepared destination subscriptions, sequence checkpoints, buffered-event deduplication and transfer of outstanding permissions/questions. Active native turns continue without a second prompt; rejected commits resume the original observer. Wait for native setup/compaction and in-flight interaction replies before detaching.
- Persist chat state before handing ownership over and record committed root-to-window placement. Resolve timed-out commits against transaction completion and durable ownership; filter stale source recovery records. Opening an already-open workspace focuses its owning live window.
- Block input/menu mutation and window close during commit. Keep background turns running when switching workspace context, preserve hydration bookkeeping and scope streaming reads/updates to their owning root.
- Validation: 2,997 frontend tests pass across 292 files, including mounted Tasks/Notes views, pending-permission handoff, rollback/lost acknowledgment, recovery/quit and identifier collision cases. Svelte/type checks have no errors or warnings; production frontend build succeeds. Native suite passes 118 tests, with one existing external-component integration test ignored. Live desktop window handoff was not exercised.

## 2026-10-11 08:32 MSK — Fix reactive workspace document views

- Register preference subscriptions outside reactive tracking so immediate subscription callbacks cannot cause an effect loop in document views, pinned links, workspace settings or context-menu labels.
- Render a fresh view snapshot of mutable document records on every revision. Checkbox/text changes, reorder, save state and external-conflict messages now update together without reusing stale Markdown.
- Validation: mounted component regressions verify checkbox-then-reorder state retention and removal of executable HTML from Notes preview; component autofixer review confirms the preview uses sanitized HTML.

## 2026-10-11 08:29 MSK — Restore workspace window groups on application relaunch

- Recreate all saved secondary-window labels, workspace groups/order, selected context, geometry and last-focused window. Discover incremental-only crash recovery records as well as full session checkpoints; startup no longer deletes saved secondary windows.
- Preserve secondary-window snapshots on application quit, remove them only on explicit close, and prevent pagehide from recreating an explicitly removed checkpoint.
- Register ready-handshake listeners before creating a webview and emit readiness after session/chat restoration. Saved windows reopen without stealing focus during construction.
- Validation: window creation, incremental recovery discovery, application-quit and explicit-close regressions pass; Svelte/type checking is clean.

## 2026-10-11 08:08 MSK — Add workspace Tasks and Notes with independent storage

- Added lazy Create/Open Tasks and Notes actions, pinned project-panel links, singleton view tabs, Markdown task checkboxes/text/reordering and source editing, and sanitized Markdown notes preview/source editing with the existing editor surface.
- Stored content in independent per-project Markdown files under application data by default, or .spec-ops-tasks.md/.spec-ops-notes.md in the project root. Session snapshots retain only view-tab identity. Closing a workspace preserves its documents.
- Added per-workspace storage selection and a separate explicit transfer command with destination replacement confirmation. Serialized preference updates across windows and added preference refresh events.
- Added debounced atomic autosave, compare-before-write external conflict detection, explicit reload/local-resolution actions and awaited document flushes before workspace/window close. Transfer rollback preserves sources until destination publication; incomplete source cleanup is reported with destination selected.
- Validation: Svelte/type checks, component autofixer review, 32 focused frontend tests and a native compare-before-write test pass. Tests cover lazy creation, independent storage, retry after disk failures, external conflicts, Markdown fences/CRLF and existing close flows.

## 2026-10-11 08:01 MSK — Add project selection and grouped file operations

- Added independent multi-selection with modifier/range/select-all controls, group context menus, newline-separated absolute/relative paths, grouped favorites, deletion and Move To folder selection.
- Added async native moves to arbitrary OS destinations, exclusive destination publication, verified cross-volume copies, preserved symlinks/hidden contents and recoverable file replacement. Conflicts offer skip/keep-both/replace with a remaining-conflicts policy; folders are never merged and open destinations cannot be replaced.
- Kept moved buffers open by updating paths across contexts/windows and removed favorites that leave their project; parent selections suppress duplicate descendant mutations. Partial failures retain source data or report retained copies.
- Validation: Svelte/type checks and component autofixer pass; 29 focused frontend tests and three native move tests cover selection, clipboard order, existing tree operations, copy/link preservation, refusal to overwrite and replacement rollback.

## 2026-10-11 00:19 MSK — Package lean application and gate component releases

- Removed mandatory agent sidecar and recursive Node/SDK/native resources from Tauri packaging; lean host build now bundles only shipped control/adapter code. Separate explicit fixture preparation keeps build/test component assets outside the base release payload.
- Built and inventoried the actual Darwin arm64 ad-hoc candidate: 18,762,344 regular bytes and 8,543,895 deterministic local gzip bytes, below 80/25 MiB budgets. Added strict whole-tree contamination checks and numerical installed cost validation without inferring signed installer/startup/RSS savings.
- Added a version-2 selected component release schema/blocked record, exact five component costs, fixed source/installed/account/distribution/platform/process gates and current-source identity validation. Historical records remain preserved. CI builds reviewable Darwin arm64 app/inventory candidates without publishing; source/component preparation is separate.
- Added actual native-source allocated component/cache/staging measurements (899,100,672 bytes across all five software roots, shared Node once), aligned probe temp roots with private metadata permissions and corrected installed missing-host recovery guidance.
- Updated setup, support and architecture docs, roadmap and H evidence. Full source regression and native managed no-account controls are recorded separately from unavailable production hosting/signing/clearance and not-run signed installed/accounts/measurements. H-05 source gate passes; other full acceptance remains open. No migration, account operation, paid inference or publication.

## 2026-10-11 00:07 MSK — Add deliberate software maintenance and trust hardening

- Added bounded authenticated catalog refresh/caching with monotonic replay/cumulative revocation and immutable manifest enforcement, reviewed signing-key overlap, exact tested update/retained/in-use producers, known native-store contract guards and actual allocated disk accounting including preserved unknown software identities. Production refresh/downloads remain unavailable until approved hosting/signing/distribution.
- Added active disk/retention budgets, operation-owned recovery, separate cache/retained cleanup and exact reviewed dependent-first group removal with all leases preflighted. Added fd-relative nofollow directory/file/create/rename/unlink boundaries, private permission/hardlink checks and latest catalog/graph/root identity validation on leased executable requests while existing cleanup replies remain available.
- Added explicit tested-update checks, safe copied diagnostics and public software recovery/packaging guidance. Native/source transport/key rotation/update/ownership/adversarial/process controls and focused UI/type/build checks pass; G-02/G-04/G-06 source acceptance lands. G-01/G-03/G-05 actual native-store/clean signed installed/full-disk/reboot/adversarial acceptance remains open. Accounts/history and historical phase evidence are preserved; no migration, unverified import, account operation or publication.

## 2026-10-10 23:51 MSK — Add reviewed agent software installation and recovery

- Added Software settings and contextual Sessions/handoff management with authenticated version/platform/reason/size/dependency inventory. Exact finite installation reviews require explicit confirmation; unavailable production distribution remains disabled. Selection/settings do not download software or start provider work.
- Added native stage/live progress, pending cancellation, monotonic/restored jobs, actionable scoped failures, reviewed same-plan/fresh-plan retries and explicit post-install connection review. Added tested-update/retained selection, software-only reviewed removal/cache controls and keyboard/focus/offline states. Missing destination installation preserves saved handoff profile/approval/exact prompt and cannot create/send a session prematurely.
- Focused frontend fixtures (35 tests), Svelte check/build and native manager tests pass. F-01–F-03 source acceptance passes; G maintenance inventory/rollback policy and actual signed installed/account/multi-window accessibility acceptance remain open. No migration, compatibility shim, publication or account operation.

## 2026-10-10 23:42 MSK — Integrate optional managed agent payloads

- Added exact managed vendor/adapter/host compatibility and full graph revalidation; packaged the native server SDK graph and notices as a separate lazy managed asset and externalized it from base host assembly. Preserved native private profile/session/worker ownership and heavy packaging until installed release acceptance.
- Added real copied all-four no-account managed controls, an opt-in separately trusted native candidate installer probe, explicit pinned native configuration testing and finite first-party registration/group-removal contracts. Corrected bounded USTAR record padding for actual candidate archives without weakening inventory/architecture/garbage checks; corrected Darwin fixture socket mode to eliminate early-header disconnect races.
- Reused verified shared Node across independent agent installs, preserved healthy siblings after failures and made reviewed download/disk estimates reflect missing software with stale-plan rejection for extra downloads. Full native suite (107 tests), host suite (352 tests), explicit pinned native config controls and actual all-five native candidate installs pass; E-05/E-06 source acceptance passes. Authenticated account/native policy/clean signed installed/hosting/signing/redistribution gates remain open under the unavailable production catalog. No migration, compatibility shim or publication.

## 2026-10-10 23:28 MSK — Resolve optional runtimes lazily from verified components

- Implemented AS09-D managed shared Node host launch, static exact runtime/capability discovery, deferred selected adapter imports, native-only authenticated component root/manifest injection and all-four managed SDK/native/helper entry resolution with bounded complete-tree hashing and path-free errors.
- Retained shared Node/agent leases for owned host generations through process-group stop/crash cleanup; generation-pinned request admission preserves concurrent cancellation/approvals and rejects stale restart bindings. Passive catalogs/profile settings start no host; missing components preserve original runtime/profile/native session without replacement or prompt replay and show explicit Software/reconnect recovery.
- Accepted D-02/D-04 source boundaries: 105 native tests, all-five real-host fixture leases/cleanup, focused resolver/process/adapter/frontend controls, TypeScript/Svelte checks and builds pass. Existing ambient installed Codex probe found an incompatible native executable; its account/installed acceptance is not inferred from filtered source tests. Trusted production bootstrap, managed vendor/reinstall/account and signed installed update/process gates remain open under the unavailable catalog; heavy packaging stays until H.

## 2026-10-10 23:12 MSK — Add native verified component installer

- Implemented AS09-C Node-independent finite catalog/list/plan/install/cancel/retry/update/select/remove/cache/diagnostic APIs, explicit hashed window confirmations, bounded credential-free downloads and generation/sequence status snapshots.
- Added strict tar/file/hash/target verification, isolated bounded native probes, immutable version receipts and atomic activation/recovery, cross-process mutation/runtime lease locks, safe active removal and private data preservation. All-five signed fixture installs, six network faults, five crash boundaries and child-process lock death pass; all 103 native tests and a focused frontend event test pass.
- Kept production downloads unavailable under embedded signed trust; preserved existing bundled payloads for D/H host/bootstrap and clean installed/signing/account/distribution acceptance. No migrations, compatibility shims or publication.

## 2026-10-10 23:00 MSK — Build trusted optional component artifact pipeline

- Implemented AS09-B native strict Ed25519 catalog/manifest authentication, exact immutable URL/target binding, finite archive identity, expiry/revision/equivocation and authenticated revocation boundaries. Embedded a signed engineering candidate catalog with all five production rows unavailable; fixture keys and endpoint policy are compile gated from installed release trust.
- Added deterministic CI-only finite Node/SDK/native candidate assembly, complete helper/mode/hash/notice/architecture/credential/budget checks and loopback fault/range fixtures. Obtained exact pinned native official archives without accounts and verified upstream hashes; copied all-five no-account controls use shared Node and isolated homes outside the checkout.
- Documented retention, reviewed external signing custody, endpoint/privacy policy, revocation/rotation/rollback and remaining publication/redistribution/signed installed/process/helper gates. Preserved bundled execution assets until replacement bootstrap is verified. No uploads, account inference, migrations or compatibility shims.

## 2026-10-10 22:47 MSK — Define optional execution component contracts

- Implemented AS09-A Node-independent strict native manifests, all-five bounded fixtures, receipt/private software roots, independent component/account/runtime states, exact app/host/adapter/dependency compatibility and lease/native-store rollback guards. Added focused contract fixtures and numeric package/installer/storage/startup/RSS budgets.
- Recorded finite prepared payload hashes/unpacked and local gzip bytes plus official pinned license/current distribution/signing decisions. Production component availability remains unavailable until exact artifact/permission/signing review; trusted catalog verification is phase B.
- Exposed baseline gaps: tracked OpenCode sidecar is a developer PATH wrapper, observed Codex differs from the tested pin, and existing installed app is stale/ad-hoc/unsealed. A-01 finite reconstruction and A-06 clean installed/process/first-use measurement acceptance remain open; source checks do not imply account/signed installed acceptance. No migrations or shims.

## 2026-10-10 22:33 MSK — Plan on-demand agent component delivery

- Added AS09 full-scope execution plans: 48 open tasks across component contracts, trusted artifacts, a Node-independent native installer, lazy host/bootstrap, four agent integrations, installation UX, maintenance/security and lean installed release acceptance.
- Planned shared Node and complete SDK/native/helper downloads on explicit request, compatible signed catalogs, bounded atomic installation/recovery, process version leases and removal that preserves accounts/history/workspace files.
- Linked stage 09 from the operations queue and roadmap; kept stage 08 recurring with new delivery acceptance and historical release evidence intact. Planning only; no runtime implementation, publication, account execution or persisted-data migrations.

## 2026-10-05 17:02 MSK — Project bounded native activity and submit finite parity

- Implemented AS02-G native child-state/activity and context-compaction events/cards through live reducers, stable history reconciliation, message layout and persisted codecs. Completed control tools do not imply child success; unfinished terminal activity remains explicitly unknown. Manual compact observes structured native progress. Native catalog permissions are hidden behind useful row labels.
- Added selected-profile credential discovery/redaction before truncation, split-fragment protection, foreign-sender/malformed/capacity guards, single failed terminal on finalization overflow and a concurrent-send ownership check. Fixed live subtask status folding and bounded secret-pattern scanning on long lexical atoms.
- Recorded the agreed A–G finite feature ledger and a separate fresh E–G source release submission with expanded required source/account/installed gates; historical evidence remains intact. No real account inference, global credentials, migrations or fallback SDK; rollback/plugins/OAuth and authenticated/installed/distribution/process acceptance remain explicit limits.

## 2026-10-05 16:41 MSK — Expose finite native ecosystem and profile configuration

- Implemented AS02-F native skills catalog/toggles, bounded current-thread tool/resource inventory, existing profile-owned server enable/disable with native reload, and versioned private web-search/reasoning-summary/verbosity defaults in the common native session panel. Disabled configured servers remain selectable for reconnect; native reload acknowledgment is distinguished from observed connection status.
- Added opaque transport/principal/generation-scoped catalog permissions, synchronous profile reservations, active-turn blocking, consumed no-replay write tokens, private canonical config CAS and symlink guards. Native MCP credentials are forced to the private file store; bounded known credential/env/header values mask projected metadata before truncation.
- Verified exact isolated native contracts/config CAS and production dispatcher/client/service/UI/persistence fixtures; actual accounts, OAuth/elicitation, upstream development-only plugins, installed/native enforcement/distribution/process acceptance remain open. No provider inference/global account reads, migrations or shims; historical release evidence unchanged.

## 2026-10-05 16:15 MSK — Expose verified native session controls

- Implemented AS02-E pinned native checkpoint fork with durable child account/settings binding and local parent lineage; source history stays intact. Manual compact observes its owned native turn after the control acknowledgment, exposes progress/activity/Stop and blocks competing sends. Native active-turn steering uses the exact turn precondition, stable native user ID and a private durable no-replay dispatch receipt; no interrupt/follow-up fallback.
- Regenerated exact native contracts, added production dispatcher/client/pipeline/store/disk and lost-ack/fault/security/UI fixtures, and retained honest per-runtime action subsets. Conversation rollback is explicitly unavailable: the pinned replacement requires paginated history while selected coding/resume supports legacy history. Context-only reconciliation does not refresh file-change watchers.
- Recorded finite source ledger and open authenticated/installed acceptance. No real inference/account credentials were used, no migrations or compatibility shims, and the historical blocked release record is unchanged.

## 2026-10-05 01:00 MSK — Record repeatable expanded source release gates

- Implemented AS08-A dated four-runtime release/support record with exact pins, selected Darwin arm64/Node 24.15.0 distribution and asset hashes, per-runtime source/account/installed lifecycle rows and explicit pass/not-run/excluded dispositions. Added fixed required-gate/pin/platform validation and a bounded private-output sequential source runner that never accepts external gates or discovers account credentials.
- Verified full frontend 2,933 tests, serial host 312 tests/7 explicit skips, Rust 79 tests, type checks/builds, isolated pinned native controls and copied account-free SDK assets. Updated the stale tooltip assertion to verify visible configuration help; recorded the initial assertion failure and concurrent packaging rerun failure transparently. Validator negative cases pass.
- Published setup/auth/configuration/history/cache/Stop/handoff/diagnostics/recovery guide, reconciled milestone states and linked historical baselines to the current blocked decision. Actual accounts/native enforcement/handoff pairs, signed installed/platform/redistribution/manual descendant acceptance remain open; AS08-A final closure and roadmap are not Done. No migrations or compatibility shims.

## 2026-10-05 00:31 MSK — Harden local native recovery and extend reviewed handoff

- Implemented AS07-D safe native auth/quota/offline classification, strict bounded history sequencing/timestamps/acknowledgements, terminal publication after worker cleanup/durable cursor settlement, and idempotent ownership release without stale cache overwrite. Exact current/pending/replaced credentials are scrubbed from profile/control responses and private persisted labels; no raw native logs/errors leave workers.
- Extended reviewed handoff to all 16 ordered four-runtime production adapter/dispatcher/client/pipeline/disk pairs, preserving frozen native tools/sandbox/catalog enum settings, source history, lineage and no first-prompt replay. Added actual worker faults, four-runtime host SIGKILL, private-key/export canaries and an explicit default-skipped authorized paid native smoke harness.
- Verified source tests/type checks/builds and copied account-free native assets outside checkout. Recorded setup/auth/policy/history/Stop/recovery/support limits and blocked expanded release baseline. Actual accounts/native enforcement, signed installed/platform/process/redistribution acceptance remain open; no migrations or compatibility shims.

## 2026-10-05 00:15 MSK — Expose finite native local settings and capability boundaries

- Implemented AS07-C immutable native file-tool presets, explicit sandbox option and bounded selected-profile catalog enum parameters through common session controls. Unsupported/no-op options fail before SDK requests; every native resume/send retains original settings and credential/workspace/model binding. Native automatic file execution and workspace sandbox policy qualifications are visible.
- Recorded supported/conditional/unsupported/unknown native feature ledger. No approval/question/hook/fork/restore/MCP/skill/subagent or Cloud execution is invented; no filesystem read-only guarantee is advertised. Writer activity exposes possible native file writes.
- Added native SDK account-free option acceptance, exact worker option forwarding, production dispatcher unsupported-action/canary and common UI/activity fixtures. Native enforcement/authenticated/signed installed/platform/distribution gates remain open; release recommendation stays blocked. No migrations or compatibility shims.

## 2026-10-05 00:01 MSK — Add durable local native agents and run recovery

- Implemented AS07-B isolated local SDK session workers, per-agent native JSONL stores, canonical profile/workspace/model/settings/original-credential binding and native agent/run identities. Native stream/text/reasoning/tool/usage/status mapping, cancellation/disposal, static failures and authoritative restart history are bounded and secret-safe.
- Added durable single-use client dispatch guards, uncertain acknowledgement recovery, no implicit prompt replay/new session, profile mutation reservations and independent worker cleanup. Minimal explicit-model agent turns use empty native tools/settings/MCP; policy editors/interactions/Cloud and tested enforcement remain unavailable pending later scope.
- Verified shared lifecycle/source/native-store wire/late-create/canary fixtures, production dispatcher/client/pipeline/store/disk recovery from divergent/corrupt caches, checks/builds and copied account-free native session-worker create/resume outside checkout. Actual authenticated/native enforcement, signed installed/platform/cleanup/distribution gates remain open; selected expanded release baseline remains blocked. No migrations or compatibility shims.

## 2026-10-04 23:33 MSK — Bootstrap isolated local native SDK profiles

- Implemented AS07-A exact official local SDK 1.0.35 host pin and full SDK/dependency/lazy-chunk/platform parser/search/sandbox payload with safe adjacent manifest resolution. Private profile workers own explicit API/service key account/catalog probes, bounded secret-safe results, generation cancellation and process cleanup; common profile UI exposes actual source support.
- Added bounded private no-follow metadata/credential import/status/logout, finite inherited environments and actionable missing/incompatible/auth/offline states. Native browser minting was evaluated but its host lifecycle, native turns/interactions/policy and Cloud execution remain unavailable in this phase.
- Verified bootstrap/credential/canary/generation/native-asset fixtures, shared profile/client checks and copied SDK plus Node outside checkout with account-free durable native JSONL create/resume and native search/helper launch. Actual accounts/inference/enforcement, signed installed/platform/cleanup/distribution gates remain open; expanded release baseline remains blocked. No migrations or compatibility shims.

## 2026-10-04 23:17 MSK — Add simultaneous named native account profiles

- Implemented AS06-C Codex profile rename/remove, stable ID/native account display and explicit missing-profile state. Removal/logout retire only the selected native process and credentials while retaining application/native session history and workspace files. Bound sessions never move to another profile.
- Added durable private original-principal guards, bounded no-follow identity reads, atomic profile metadata, finite inherited execution environment and private home/config roots. Credential/process mutations reserve their owner before awaits; wrong-account resumes, unknown principals/actions and stale native operations fail explicitly without replay or quota rotation.
- Verified separate real fixture processes with equal native IDs, sibling fault/cancel/quota/login isolation, production two-profile persistence and actual whole-host loss. Added a default-skipped explicitly authorized real-account harness; actual account/browser/signed installed/platform/cleanup acceptance remains open and the expanded release baseline remains blocked. No migrations or compatibility shims.

## 2026-10-04 22:58 MSK — Add bounded native session lifecycle and workspace catalogs

- Implemented AS06-B finite host capability requests, explicit fork/revert/restore/publish/revoke and configured tool-server connect/disconnect, with profile reservations and immutable generation/binding checks. Common Sessions attaches fresh fork lineage and reconciles native checkpoint history without replay; workspace watchers refresh.
- Added selectable native checkpoints, bounded tasks/diffs/file/language/command/provider/config/tool/skill/agent projections and independent vendor-neutral UI. Private credential values and transport secrets are scrubbed before truncation; control bytes are capped before SDK parsing. External endpoints, unowned inference actions and arbitrary configuration/OAuth/editor flows remain unavailable with a finite scope ledger.
- Verified source fixtures, neutral UI/client/pipeline/persistence checks and real isolated pinned account-free catalog/fork control smoke. Paid native restoration/sharing, signed installed/account/platform/cleanup acceptance remains open; expanded release baseline stays blocked. No migrations or compatibility shims.

## 2026-10-04 22:36 MSK — Add reviewed native session handoff and durable lineage

- Implemented AS06-A common Handoff review with separately editable/removable bounded context sections, safe workspace excerpts/patches, target runtime/profile/model/policy selection and frozen exact first-prompt preview. Source native history stays independent; cancellation creates no target. Private paths/raw tool output/common secret values are excluded by default.
- Added private strict Unix no-follow/CAS/lock/fsync create/send intent storage, explicit uncertain outcomes, fresh native targets, immutable neutral lineage and single-use initial-send permits. Unknown creation/possibly accepted prompts are never automatically retried. Index lineage survives corrupt thread caches; draft promotion preserves a precreated native binding to prevent a second hidden target.
- Verified nine ordered source-adapter pairs through production dispatcher/client/pipeline/store/disk, review/security/fault/concurrency fixtures and full frontend/host regressions. Real provider/account pairs, signed installed/platform/legal/cleanup gates remain open; unsupported durable storage fails before native creation. Published the selected blocked release baseline; B/C remain separate work. No migrations or compatibility shims.

## 2026-10-04 22:10 MSK — Harden native runtime recovery and common secret boundaries

- Implemented AS05-D source fault/security matrix and static actionable native error/limit recovery. Failed turns preserve selected account credentials/generation/session/settings, do not replay prompts or rotate bindings, and leave siblings usable. Native history identity fields and normalized envelopes are now redacted at the full common hydration boundary.
- Added actual pinned SDK child-exit/stderr-canary checks, production three-runtime host SIGKILL with pending native approval, credential-bearing persisted/corrupt-cache hydration and three-runtime support-export coverage. Host/frontend checks/builds and copied-assets account-free control smoke passed.
- Published dedicated API key setup, immutable session recovery, native feature/support limitations and a blocked expanded subset release record. Actual credentials/provider enforcement, signed installed/legal/platform cleanup and immediate unobserved descendant-exit acceptance remain open. No migrations or compatibility shims.

## 2026-10-04 21:58 MSK — Add native third-runtime interactions and immutable policy controls

- Implemented AS05-C source correlated native permission/question callbacks, once-only resolution, safe session-scoped rule approval, unsupported-dialog cancellation, deadline/Stop/reconnect interruption and stale profile/turn/generation rejection. Authenticated native source turns are enabled; installed/live acceptance remains open. The actual pinned SDK control dispatcher is covered by a child-process wire fixture, without credentials or inference.
- Added validated native approval/tool/turn-limit/budget descriptors, a finite built-in tool subset and neutral string/number creation controls. Unknown/unsafe/conflicting settings fail before dispatch. Approval/planning never claims a read-only sandbox; writer visibility reports possible/unknown. Common prompts display operation/rule scope, single/multiple choices, descriptions and free text; native previews stay explainably unavailable.
- Recorded isolated filesystem config and managed policy/memory qualifications plus a finite execution/display/editing ledger for optional ecosystem surfaces. Full host, focused frontend/persistence fixtures, type checks/builds and explicit bundled no-account native control create/history passed. Real provider permissions/policies, installed/platform cleanup/legal and release gates remain open; no persisted-data migration or compatibility shim.

## 2026-10-04 21:34 MSK — Add profile-bound third-runtime native session lifecycle

- Implemented AS05-B developer source native session initialization/send/resume/history/cancel, immutable profile/workspace/model/settings and credential binding, stable native/client message identities and atomic cursors. Native readers remain profile-isolated; accepted missing history preserves metadata without new sessions or prompt replay. Control-only UUID reservations are distinguished from accepted native conversation history.
- Added bounded native text/thinking/tools/results/usage/cost/error mapping, fragmented credential redaction, single-terminal drain, pending/late cancellation, concurrent-send guards and observed process-tree retirement. Native turns default off; empty tools/manual deny policy remains until C interaction acceptance. Rich native history hydrates through production dispatcher/client/pipeline/disk and fresh app/host fixtures.
- Pinned SDK 0.3.289/native 2.1.289 contracts, host/frontend checks/builds and deterministic regression/integration evidence are recorded in phase notes. Real Darwin arm64 control-only creation/history probe passed without account credentials or inference. Live accepted-turn/account, signed installed/platform cleanup and release gates remain open. No persisted-data migration or compatibility shim.

## 2026-10-04 21:09 MSK — Bootstrap third native runtime SDK and isolated API key profiles

- Implemented AS05-A host-only official native SDK 0.3.289 / executable 2.1.289 bootstrap, same-host packaged module/native/license assets and manifest identity checks. Added isolated private profile credential import, non-inference API authentication verification, logout/reconnect and stale-generation guards, dynamic native model catalogs and common profile selection. Unsupported subscription/cloud login, turns and native session settings remain explainably unavailable.
- Official auth/embedding contracts and distribution strategy are recorded in phase notes. Deterministic credential/security/bootstrap tests, host/frontend type checks and builds passed; an explicit credential-free Darwin arm64 package probe imported the full copied SDK outside the checkout and initialized the native model catalog with no developer installation. Installed, live-account/inference and signed release/platform cleanup gates remain open; no migrations or compatibility shims.

## 2026-10-04 20:52 MSK — Cut over common Sessions to native host runtimes

- Implemented AS04-C source cutover: removed WebView SDK/direct backend, Rust competing supervisor, temporary ownership gate, obsolete native UI/stores/codecs/tests and transport settings. Common runtime/profile/model/mode selection, isolated local/external profiles and host-only private-file provider import preserve missing-profile/history bindings without migrations. Rich controls remain unavailable with a finite later-extension ledger.
- Extended shared activity with honest write-policy states, Continue/Stop and persisted writer-warning preference, bounded changed-path overlaps and native diff refresh. Added packaged Node 24/license/hash manifest and host resources, deterministic host metadata, exact installed native asset resolution, explicit overrides and bounded allowlisted support details.
- Validation: full frontend 2863 tests, host 157 tests with bundled no-account native smoke, Rust 78 tests, type checks and builds passed. Production host/client faults prove healthy runtime isolation and joint whole-host settlement without replay. Copied Node/host lifecycle passed outside checkout. Source work is complete; live-account/provider, signed installed/platform cleanup, immediate descendant-exit and release acceptance remain open. 06-B remains Planned; 08-A records a blocked subset baseline.

## 2026-10-04 20:27 MSK — Add second-runtime native core session parity

- Implemented AS04-B native create/read/resume/history with immutable profile/workspace/model/mode binding in native metadata and persisted native/client message identity. Production dispatcher/client/pipeline/disk fixtures recover divergent or corrupt caches without replay or duplicate messages.
- Added a separate bounded cancellable SSE subscription, normalized text/reasoning/tools/steps/subtasks/file changes/usage/errors/retry/compaction, host cursors/generation isolation and bounded redacted unknown events. Correlated permissions/questions resolve once; Stop/deadline/fault settles native work before releasing the session, with late-ack abort and owner-only retirement on unconfirmed cancel.
- Validation: 154 host tests passed (two opt-in skips), 38 explicit bundled-native bootstrap/core tests passed including account-free native create/restart/read/resume, 56 focused frontend regression/integration tests and host/frontend checks/builds passed. Source scope is complete; C retains concrete runtime/profile UI, private-file credential import and legacy removal. Live provider/account/tool/interactions, installed/platform cleanup and release gates remain unverified; rich native extensions remain unavailable. No data migration or compatibility shim.

## 2026-10-04 20:05 MSK — Add isolated second-runtime host bootstrap

- Implemented AS04-A source ownership/profile/bootstrap: exact host SDK/runtime 1.17.4 and reproducible host lockfile, packaged executable propagation, isolated native homes/config/provider auth, host-only loopback password/port, explicit external endpoint ownership and finite core/extension ledger.
- Added a default host / explicit legacy parity process-start gate, bounded connection/version probes, safe profile snapshots and stale-response rejection, native auth persistence/logout/restart, private credential storage and observed descendant retirement. Core session/events remain the next plan; legacy files remain until cutover.
- Validation: 125 host tests passed (one ordinary opt-in skip), 8 explicit bundled-native bootstrap tests passed without account credentials, host/frontend checks and host build passed, 17 Rust host tests passed. Upstream installed/account baseline, paid-provider inference, installed owner switching, platform packaging and immediate descendant-exit race remain open. No data migration or compatibility shim.

## 2026-10-04 17:49 MSK — Harden experimental native faults and credential boundaries

- Implemented AS02-D source fault/security closure: malformed/oversized/crashed native fixture retirement, bounded ignored cancel, profile-local observed descendant cleanup preserving the supervisor group, selected logout credential cleanup and safe direct auth results.
- Masked supported secret shapes in native text/reasoning/tool events and hydrated history without truncating benign output. Streaming retains split credential fragments across unrelated item completions; cumulative state bounds hold even with draining consumers.
- Verified actual bundled-host death with two active production-client native streams and a pending approval, retaining bindings/history without replay. Recorded setup/recovery procedures and a blocked AS08-A selected-scope matrix; immediate descendant spawn/crash race, human account-A/B and installed AS03-A/B remain open. Default-off experimental legacy coding stays unaccepted as baseline.
- Validation: 118 host, 3,238 frontend and 17 Rust Agent Host tests; host/frontend checks and production builds passed. Native contracts unchanged. No live account credentials/default auth files read, installed acceptance, migration or compatibility shim.

## 2026-10-04 17:32 MSK — Add profile recovery, optional settings and authoritative native history

- Implemented AS02-C supported source scope: optional neutral session configuration descriptors replace runtime-specific common-UI branches, with model-specific effort defaults, separate sandbox/approval/collaboration scope and validated session overrides. Profile config remains native-owned; the persisted experimental protocol gate defaults off.
- Added per-profile/account/limit sparse usage merges, actionable quota/auth-expiry/offline/retry states, explicit backend-authorized quota recovery and isolated logout/session auth-required marking. Supervised host epoch plus child generation prevent stale auth state after whole-host replacement; old-host account replies are rejected.
- Reconciled full materialized legacy native history by stable turn/item IDs, terminal-first deduplication and retained interrupted partial work. Production persistence reconstructs divergent/duplicate/corrupt caches, preserves readable local metadata/lineage, retains missing-native-thread records and never silently replays prompts. Sparse/paginated history and unavailable native management panels remain explicit pinned-runtime deferrals.
- Recorded the pinned execution/display/configuration ledger and reproducible 199-file/46-root contracts. Validation: 102 host, 3,237 frontend and 17 Rust Agent Host tests passed; host/frontend checks and both production builds passed. Real account-B inference/account-A preservation, native extension/instruction smoke, whole-host UI recovery and installed readiness remain external gates. No persisted-data migration or compatibility shim.

## 2026-10-04 17:01 MSK — Add native coding turns and minimum thread resume

- Implemented AS02-B source thread start/read/resume, deterministic native text/reasoning/tools/file/usage events, stable native IDs/generation correlation, single-terminal streams, native interrupt and selected-child loss settlement.
- Added correlated command/file approvals and supported native questions with explicit allow/deny/answer/cancel/deadline handling, late/stale reply rejection and prompt visibility across remount. Frontend stream observation settles waiting UI on terminal/loss and cancels/disposes bounded producers.
- Persisted distinct model/effort/collaboration/sandbox/approval settings and write capability through the production pipeline; fresh app/host fixtures hydrate completed native history and continue the same thread without replay or duplicate messages.
- Verified the official pinned npm distribution: default paginated history lacks required hydration support. Added a default-off persisted profile experimental checkbox and blocked coding before work without opt-in; opted sessions use explicitly selected legacy history. Recorded actual no-account legacy marker/read/resume evidence and deterministic 188-file/44-root generated contracts.
- Validation: 94 host tests and 3,229 frontend tests passed; host/frontend checks and production builds passed. Native process/shared-contract fixtures, actual dispatcher/client/pipeline/disk restart and approval-child-loss integration, remount/abort/overflow/disposal UI checks passed. Authenticated coding/account preservation, whole supervised-host smoke and installed readiness remain explicit external gates. No data migration or compatibility shim.

## 2026-10-04 16:28 MSK — Add isolated Codex connection and authentication

- Implemented AS02-A source control plane: pinned 0.160.0 app-server handshake/schemas, bounded profile child transport/restart/generations, official account read/browser/device/API-key login/cancel/logout, native creation shell and model discovery. Native turns/resume remain the next execution plan.
- Added private app-data profile homes, explicit file credential storage, controlled inherited authentication/provider environment, permissions and symlink checks, secret-safe auth updates and host-only browser/device/API-key handling. Default desktop credentials are never copied.
- Added neutral Sessions enablement and runtime/profile creation/selection, ensure-start catalog recovery, immutable profile-aware bindings and actual draft/index/session persistence; runtime/profile namespaces separate equal native IDs.
- Verified the actual pinned binary without login in a temporary isolated home; required initialization/account/control/catalog methods passed and contract regeneration was byte-identical. Recorded setup/distribution/support evidence and kept real account-B sign-in plus installed acceptance explicitly pending.
- Validation: 3,222 frontend tests, 73 host tests and 16 Agent Host Rust tests passed; frontend/host type checks and production builds passed. No data migration or compatibility shim. Existing unrelated Rust formatting differences/warning and canvas-stub notices remain.

## 2026-10-04 15:54 MSK — Stabilize foundation persistence, transport and supervision

- Implemented AS01-S-01–05: full production binding/mode/runtime-settings persistence, per-session debounce and serialized index writes; native sends await binding storage. Resume rejects incompatible runtime/native IDs explicitly.
- Moved supervisor stdin writes to a bounded background queue, serialized lifecycle operations, enforced request deadlines, repaired cooperative shutdown and generation-safe process-group cleanup. Event/framing loss retires the generation; untrusted stderr content is excluded from application logs.
- Bounded host framing/output/dispatch and frontend stream queues; added stateful UTF-8 decoding, real response backpressure, bounded cancel/drain, broken-output settlement, listener/status/generation recovery and secret-safe error/diagnostic output.
- Strengthened shared adapter contracts with complete iterator drain, mandatory fault/capability fixtures and fresh-instance/process resume. Fixed terminal replay, incremental usage totals, subtask terminal events, catalog extension ownership, target binding descriptors and strict codec round-trips.
- Accepted source-checkout macOS scope; Windows host launch is explicitly disabled until tree cleanup is implemented. Linux/installed packaging and native creation/catalog gates remain assigned downstream. Added the full Critical/Major disposition ledger, support bounds, setup notes and updated plan/roadmap statuses. No persisted-data migration or compatibility shim.
- Validation: 3,217 frontend tests, 61 host tests and 97 Rust tests passed (Rust serial); frontend/host type checks and production build passed. Process fixtures cover unread stdin, ignored shutdown/cancel, concurrent starts, host crash and TERM-resistant descendants. Existing canvas-stub notices, one unrelated Rust test warning and the same two pre-existing Markdown-link issues remain.

## 2026-10-04 14:53 MSK — Reorder operations folders and archive completed records

- Renumbered the active queue: 01 foundation stabilization, 02 Codex, 03 early preview delivery, 04 OpenCode core, 05 Claude, 06 handoff/native extensions, 07 Cursor and 08 recurring release gates.
- Split early activity/packaging, later handoff/OpenCode extensions/Codex profiles and release acceptance into their corresponding ordered directories; renamed phase files and active task IDs to match.
- Moved implemented foundation A–F, implementation notes and completed review/audit artifacts into `specs/ops/done`. Historical task IDs are preserved; unresolved acceptance remains assigned to active plans.
- Added active/done navigation and updated roadmap, scopes, indexes, dependencies and links, including references in historical changelog entries.
- Validation: all 22 active phases and 98 tasks retain their acceptance criteria; active prefixes and local links verified. Repository-wide Markdown checking retains the same two pre-existing issues. Runtime code and credentials unchanged.

## 2026-10-04 14:38 MSK — Adopt Codex-first operations composition and delivery order

- Rewrote the active roadmap and all milestone scope/index/phase plans around foundation stabilization, isolated Codex accounts, usable installed Codex delivery, OpenCode core, Claude, later handoff/native extensions and Cursor.
- Added phase AS01-S for reopened production persistence, bounded supervision/transport, failed-stream settlement, redaction and strengthened acceptance evidence; preserved A–F implementation history with explicit historical status.
- Added profile identity, isolated native auth/config homes, profile-scoped routing and control-plane events throughout runtime plans. Codex A–D now accept the separate-desktop-account scenario without a Claude prerequisite; later E covers simultaneous accounts inside SpecOps.
- Moved shared activity and host/Node packaging/diagnostics/recovery to independent early AS06-B/C gates; defined repeatable selected-runtime/platform release acceptance without requiring all adapters or handoff.
- Changed OpenCode order to A → B → D core cutover, with C native extensions later; updated Claude/Cursor auth-policy, native capability/configuration and installed-asset verification tasks.
- Marked the audit proposal adopted and linked historical evidence to active gates. No runtime implementation or credentials changed.
- Validation: 22 active phase plans, 98 unique tasks with acceptance, 234 local operations-document links and an acyclic default dependency graph verified; whitespace checks passed. Repository-wide Markdown check retains the same two pre-existing issues outside these changes. Runtime tests were not repeated for this documentation-only revision.

## 2026-10-04 14:15 MSK — Audit agent-runtime tasks and propose Codex-first delivery

- Added an implementation audit of operations milestones 01–06, separating the fake-runtime foundation, acceptance gaps, legacy integration code and missing production adapters.
- Recorded verified persistence, supervision, stream-failure, redaction, catalog/creation UX, contract-test and packaging gaps; proposed bounded stabilization tasks.
- Proposed isolated Codex connection profiles for an account separate from the desktop app, with profile-scoped authentication, native history, process routing and acceptance checks.
- Added an alternative delivery sequence prioritizing a usable Codex preview and moving recovery, packaging and basic activity visibility ahead of additional adapters and handoff. Linked the review from the roadmap and milestone scope documents; implementation statuses are not promoted by this proposal.
- Validation: 115 targeted frontend/domain tests in 13 files and 48 Agent Host tests in five files passed. No runtime code or account credentials changed; real-account, full Rust and installed-build verification remain outside this audit.

## 2026-10-04 14:03 MSK — Resolve integration merge conflicts

- Combined the session architecture with current appearance settings, project-tree actions, favorites, preview tabs and compact secondary windows.
- Preserved project search cancellation, progress and scanned/unreadable counts alongside stable ordering and oversized-file reporting.
- Unified file-drop listeners so context targeting and the visible drop overlay share the same opener and large-file bypass; retained preview-tab handling for ordinary file opens.
- Removed obsolete chat-context checks and updated test fixtures to the current state and event contracts. Preserved file-icon persistence coverage after removing the obsolete settings test suite.
- Validation: 3,198 frontend tests, seven release-helper tests and 94 Rust tests passed (Rust tests run serially after a port-allocation race); type checking reported zero errors/warnings; production build passed. The documentation link check reports two existing broken links.

## 2026-08-15 23:25 MSK — Fix drag-and-drop file opening: reads limited to $HOME, silent cross-window no-ops, 1 MiB confirm stubs, invisible errors

Drag-and-drop almost never opened files because four independent gates sat in
the drop path (`onDragDropEvent` → `openDroppedPath` → `openActivePath`), and
every failure surfaced only as easy-to-miss status-bar text, so each one looked
like a silent no-op:

- **fs scope rejected any path outside `$HOME`/`$APPDATA`** — `stat` (the very
  first call on the drop path) failed for `/tmp`, `/Volumes`, `/var/folders`
  (browser/mail temp files) etc. Read-type permissions (`fs:allow-stat`,
  `fs:allow-read-file`, `fs:allow-read-text-file`, `fs:allow-read-dir`) now
  allow `**`: reads follow explicit user gestures (picker, drop, app-icon
  open) that can target any path the OS allows, while the credential deny
  lists (ssh keys, keychains, cloud tokens) and the write-under-$HOME policy
  are unchanged.
- **Stale cross-window claims swallowed opens silently** — if
  `open-files.json` credited a closed/crashed window with the path, the drop
  "redirected" into the void: `emitTo` went nowhere and the owner-side
  `SELECT_TAB_FOR_PATH` handler ignored a missing tab. Now the dropping window
  verifies the owner is live, prunes dead-window claims and takes the claim
  locally; the owner-side handler falls back to opening the file itself on
  registry desync.
- **Large-file confirm gate (default 1 MiB) turned most real drops into
  "pending confirm" stubs.** Drops now bypass the user's confirm threshold —
  the drop itself is the explicit gesture — with a hard ceiling
  (`DROP_OPEN_HARD_MAX_BYTES`, 512 MiB) still landing oversized files as
  confirm stubs. Pickers/tree/recent keep the old threshold.
- **Failures were invisible.** New minimal toast bus (`toastBus.ts` +
  `ToastOverlay.svelte`): failed/missing dropped files and inaccessible
  dropped workspaces now raise a visible error toast; the status bar keeps its
  informational line.
- **Drop feedback:** `onDragDropEvent` now handles `enter`/`over`/`leave`
  (previously only `drop`), driving a `FileDropOverlay.svelte` full-window
  highlight ("Drop to open files") via a `fileDragActive` store.
- Robustness/cleanup: the drag-drop listener registers **first** in the
  runtime startup chain (a failure in any later listener used to leave the
  window without drop handling for the whole session); removed the dead
  duplicate `openDroppedPath` loop in the page handlers; `openAndActivatePath`
  now threads `OpenPathActivationOptions` and returns its
  `OpenActivePathResult` so the drop path can react to failures. Fixed
  pre-existing broken relative imports in `appShellHostTypes.ts` (its
  `../../domain`/`../../services` paths never resolved).
- Tests: dropped-file gate bypass + hard ceiling, dead-owner claim takeover,
  error toasts for failed/missing/vanished drops and blocked workspaces,
  toast bus stack behaviour.

## 2026-08-15 23:12 MSK — Fix Find-in-Project: results wiped/cancelled, picker insta-close, stuck Searching; add project-panel search button

The workspace-switch effect in `+page.svelte` called
`closeAllOnWorkspaceSwitch()` on **every** re-run, but it re-runs far more
often than workspace switches: the `workspaces` array identity changes on
every active-context snapshot update (every tab open/close/activate), and the
`getState()` reads inside the close call made all ten overlay flags effect
dependencies too. Consequences: in-flight and finished project-search results
were cancelled/wiped moments after landing (search "never finds anything"),
and freshly opened modal pickers (quick open etc.) closed themselves
instantly.

- **Root fix:** the close/cancel half now fires only when `activeWorkspaceRoot`
  actually changed, and runs untracked so overlay-flag reads never widen the
  effect's dependency set. `closeAllOnWorkspaceSwitch` also patches only
  flags that are actually open.
- **Search cancellation hardening:** the generation is bumped *before*
  awaiting the file catalog (a close/switch during the wait now aborts instead
  of leaking a full scan for a closed panel), and `waitForReady()` waiters are
  released when a catalog is disposed (previously they hung forever with the
  panel stuck at "Searching…" and the Search button disabled).
- **Search observability:** the scan reports live progress ("Searching… N
  files" every 200 files) and the status line now includes scanned/unreadable
  file counts (`stat`/`readTextFile` failures are counted instead of silently
  skipped), so "No results" is distinguishable from "read everything failed".
- **Project panel:** new search (magnifier) button in the panel header that
  opens Find-in-Project for the active workspace — same as Cmd+Shift+F.
- Tests: overlay coordinator (no-op patch when nothing is open),
  `runProjectSearch` (wait-window cancellation, count/progress status), and
  `searchInProject` (scanned/unreadable counters).

## 2026-08-15 — Milestone 01 code review: findings recorded (review round 1)

Full-milestone review of the phase A–F implementation (session domain, adapter
contract + fake runtime, Agent Host package, Tauri supervision, frontend
Sessions integration) recorded in
[`specs/ops/done/01-foundation-agent-host/review-issues-1.md`](ops/done/01-foundation-agent-host/review-issues-1.md).
All targeted suites are green, but the review found 3 Critical and ~29 Major
issues concentrated in shutdown/recovery paths, binding persistence, and the
shared contract suite; several phase acceptance criteria are only partially met.
The issue list includes a recommended fix ordering — a stabilization backlog
that should land before/with phase 02, since the phase-02 exit gates depend
directly on the affected paths. No code changed in this commit.

## 2026-08-15 10:05 MSK — Phase F: Sessions UX through the Agent Host; foundation milestone 01 complete

Workspace Sessions is now fully runtime-neutral: the UI, state, and send
pipeline drive the supervised Agent Host through the phase-E Tauri bridge, and
every provider-prefixed session field is gone from common code. **Breaking
sessions-state reset** — persisted session indexes and thread files with the
old provider-prefixed fields no longer decode; per repo policy there is no
migration (the store starts clean).

- **Neutral session binding (F-01):** `SessionIndexEntry` /
  `ChatThreadMetadata` / the `chatStore` link API / the persistence codec use
  `runtimeId` + `nativeSessionId` + `modelId` + `shareUrl` + `parentSessionId`
  (+ `selectedModeId`, `runtimeId` on thread metadata). The runtime binding is
  immutable: re-linking a bound session to another runtime or native session is
  rejected — create a new session instead.
- **Host-backed send pipeline (F-03):** `chatSendPipeline` no longer constructs
  a workspace backend or the legacy sidecar. It lazily starts the supervised
  host (one cached start), creates or resumes the native binding, streams
  `turn.send` events through `foldSessionEvent` into the live transcript,
  replies to permission/question prompts through the host, cancels via
  `turn.cancel`, and maps typed host errors to user-facing copy. Retry logic,
  queue/steer, attachments, and prompt history are unchanged.
- **Neutral Sessions UI (F-02/F-03):** the composer gains a runtime label +
  neutral model/mode pickers fed by host catalogs (with explanatory
  loading/empty/error states); the panel header shows the session runtime and
  Agent Host health, plus a host-restart recovery action. Lifecycle actions
  without a host protocol method (fork / revert / share / summarize / export /
  external session browsing) are hidden; rename stays local-store. Sidecar-fed
  UI glue is deleted (todo/diff panels, slash-command and mention pickers,
  agent/provider catalog picker, `session.messages` hydration) and the
  session-list "Import" entry point is hidden.
- **Regression + docs gate (F-04):** new tests cover store binding
  immutability, the host send pipeline against a mocked client (create /
  resume / stream / permission / cancel), the neutral persistence round-trip,
  and a phase-F absence guard (no provider-prefixed session field and no
  vendor SDK import in common code). Architecture + user docs now describe
  Sessions only; the OpenCode integration guides moved to
  `specs/archive/ops-postponed/docs/`.
- **Milestone 01 → Done** in the milestone README, execution-plan index, phase
  F plan, and roadmap; phase 02 (Claude adapter) is unblocked against the
  stable host/adapter contract.

Deferred cleanup (documented in the phase F plan): the Sessions dev gate still
lives under `settings.opencode` / the OpenCode settings surface; renaming it to
a neutral sessions gate lands with the settings-surface cleanup. The legacy
workspace backend + sidecar remain untouched as the phase-04 adapter candidate.


## 2026-08-12 10:45 MSK — Phase E: Tauri supervision and process-tree cleanup

The Agent Host is now a resilient, observable, fully reaped application child.
The WebView never spawns, connects to, or imports the host or any vendor runtime;
every UI request flows through Tauri to the host JSON-RPC bridge, and every host
notification is forwarded as a typed Tauri event.

- **Reusable host supervisor (`app/src-tauri/src/agent_host.rs`):**
  - Monotonic process generation: at most one generation owns requests; a stale
    stdout reader cannot resolve a request or mark health on a replacement child.
  - Bounded stdout/stderr drainers (per-line byte ceiling + line-count cap) so a
    chatty/broken host cannot exhaust memory or block its pipes.
  - Pending-request correlation over a sync condvar with per-request deadlines;
    initialize has its own shorter window.
  - Crash-loop breaker: after repeated starts within a window, restarts are
    refused with a typed `CrashLoop` error.
- **Bridge commands + events:** `agent_host_start`/`stop`/`restart`/`status`/
  `request`; the generic `agent_host_request(method, params)` is the single pipe
  the WebView uses. Notifications are forwarded on `specops/agent-host/event`.
  Protocol errors arrive as typed `AgentHostError::Protocol`; transport failures
  use the remaining typed variants.
- **Shutdown + recovery policy:** cooperative `shutdown` request → stdin close →
  bounded grace → process-group termination (negative-pgid `kill`) → SIGKILL →
  reap, on every path (normal quit, explicit stop, host crash, hung shutdown).
  The group is signalled even after a cooperative leader exit so grandchildren
  the host left behind are reaped. Wired into app `run_shutdown_cleanup`.
- **Supervision tests (13):** real-host lifecycle + clean shutdown; crash
  recovery; ignored/hung shutdown force-killed within a bounded window (with a
  noisy stderr stream); grandchild process-group reaping (no orphan remains on
  supported platforms); stale-generation isolation; bounded-line reader.

## 2026-08-12 09:00 MSK — Phases C + D: adapter contract, fake runtime, and bundled Agent Host

Foundation milestone 01 can now drive a deterministic fake runtime end to end
through a secret-safe local host. No vendor SDK type appears in any common
payload; the WebView imports no host code.

- **Phase C — adapter contract + deterministic fake runtime (`app/src/lib/session/adapter/`):**
  - **Mandatory core (C-01):** `AgentRuntimeAdapter` (describe / authenticate /
    createSession / resumeSession / send `AsyncIterable<SessionEvent>` / cancel /
    health + optional describeCatalog) with typed `AdapterError` codes, and
    documented terminal-state semantics: `turn.started` first, exactly one
    terminal event, monotonic `seq`, idempotent `cancel()`.
  - **Capabilities + extensions (C-02):** optional `Catalog`/`Permission`/
    `Question`/`Lifecycle`/`Checkpoint`/`Share`/`Configuration`/`Mcp`/`Skills`/
    `Commands`/`Todos`/`Diffs`/`Diagnostics` extension interfaces with type
    guards and a capability→extension honesty map (`inferCapabilities`); runtime
    settings extend the UI via configuration instead of widening the core.
  - **Deterministic fake runtime (C-03):** declarative `FakeRuntimeConfig`
    drives scripted create/resume/stream/cancel, tools, permission/question
    gating, error injection, unknown/malformed → redacted diagnostic coercion,
    hang/interruption, and restart behavior — no network, clock drift, or
    vendor binary.
  - **Shared contract suite (C-04):** `runAdapterContractSuite(factory)` asserts
    the universal invariants (lifecycle order, monotonic seq, terminal
    exclusivity, cancellation, restart, capability honesty); the fake passes and
    phases 02–05 plug real adapters in unchanged. 27 adapter tests (12 contract
    + 15 fake-specific).
- **Phase D — bundled Agent Host (`app/host/`):**
  - **Host package + build (D-01):** self-contained Node package; esbuild bundles
    to a single `dist/index.js` with injected deterministic version metadata;
    registers the fake adapter (dev prompts `ping` / `long-running`); reports
    `protocolVersion:1`, `name:"specops.agent-host"`, `hostVersion:"0.1.0"`.
  - **Versioned JSON-RPC protocol (D-02):** newline-delimited JSON-RPC 2.0;
    initialize/version negotiation (incompatible versions fail at init), discover,
    auth, catalogs, sessions, turns, replies, cancel, events, health, shutdown;
    message limits, timeouts, and explicit protocol error codes.
  - **Framing, dispatch, backpressure (D-03):** eager newline framing with
    oversized/malformed rejection and high-water reset; correlation (one response
    per request); turn streams as `session.event` notifications with ack-first
    ordering and pull-based backpressure; cancellation forwards `turn.cancelled`;
    mid-stream rejection synthesizes `turn.failed`; graceful shutdown cancels and
    awaits every active turn. stderr is never parsed as protocol.
  - **Redaction + golden fixtures (D-04):** recursive secret redaction on all
    stderr/error output (secret canaries never cross the diagnostic boundary);
    golden fixtures for valid/malformed/oversized/unknown/timed-out. 48 host
    tests (protocol, framing, dispatch, redaction, real-stdio E2E).
- **Domain notes:** the deterministic `fake` runtime id was added to
  `AgentRuntimeId` as dev infrastructure; the four product runtimes stay
  first-class via `PRODUCT_RUNTIME_IDS` / `productRuntimeDescriptors()`. Two
  unused declarations surfaced by the host's stricter `noUnusedLocals` were
  removed from the phase B session domain.
- Implementation notes: `implementation-notes-phase-c.md`,
  `implementation-notes-phase-d.md`. Phases C and D marked Done in their plan
  docs and the milestone README.
- Out of scope (later phases): Tauri process supervision + process-tree cleanup
  (E), Sessions UI integration + foundation exit (F), real vendor adapters
  (02–05). No persisted data is migrated.

## 2026-08-12 02:20 MSK — Phase B: runtime-neutral session domain and persistence

- Added `app/src/lib/session/`, the runtime-neutral session domain that Phase C
  adapters produce/consume, Phase D/E hosts transport, and Phase F integrates.
  No vendor SDK types appear in any public payload.
- **Ids + binding + lifecycle (B-01):** branded `SpecOpsSessionId` /
  `SpecOpsTurnId` / `NativeSessionId` (unique-symbol brands make SpecOps vs
  native ids un-confusable at the API surface); `AgentRuntimeId`
  (`claude|codex|opencode|cursor`); `AgentNativeBinding` + `AgentSessionRef`
  with model/mode metadata and lifecycle statuses. Runtime binding is
  immutable — `rebindRuntime` returns a new session id rather than mutating.
- **Normalized turns + events (B-02):** `SessionEvent` union
  (text/reasoning/tool/subtask/step/attachment/diff/usage/compaction/
  permission/question/status/turn/diagnostic) + `SessionTranscript` and the
  pure `applySessionEvent` reducer (deterministic replay). Unknown native
  events are preserved as redacted `diagnostic` events; secret redaction
  (bearer/API-key stripping + size bounding) runs before persistence.
- **Persistence schema + codecs (B-03):** versioned `SessionRecord` and
  per-workspace `SessionStoreIndex` around the native binding — no
  provider-prefixed fields. Canonical (key-sorted, redacted) JSON encode;
  decoders fail explicitly on corrupt input (no silent partial decode).
- **Tests (B-04):** 37 domain/codec tests covering every union variant,
  immutable binding, unknown→diagnostic, malformed data, and restart
  round-trips.
- Implementation notes: `specs/ops/done/01-foundation-agent-host/implementation-notes-phase-b.md`.
- Out of scope (later phases): rewiring the live OpenCode workspace-session
  store/UI onto the new domain (Phase F), host transport (D/E), real adapters
  (C / 02–05). No persisted data is migrated (the new schema is additive).

## 2026-08-11 23:50 MSK — Phase A: remove standalone Chat and dormant Cloud surfaces

**Breaking reset of AI state** (pre-release; no migration per repository policy):
the standalone HTTP Chat (beta) context and the reserved Cloud context are gone.
Old `provider-secrets.json` HTTP-connection keys and any `chat/` thread files
carrying HTTP provider/mode/connection metadata are ignored on load.

- Removed the `chat-http` and `chat-cloud` activity-rail contexts, their
  `WindowContextState` snapshots, restore/snapshot/sanitizer paths, and the Dev
  "Enable Chat (beta)" gate. The activity rail is now `[Notepad] | [Workspace …]`.
- Removed the entire HTTP provider system: provider registry/types/bootstrap,
  the `http` / `debug-chat` / `debug-workspace` providers, OpenAI-compatible +
  SSE adapters, HTTP connection settings, model catalogs, capability checker,
  connection/rail gating, and the `ai/providers/` module tree.
- Removed the chat-modes product (ask/review/raw system prompts, settings, and
  picker) and `ChatThreadMetadata.mode` / `provider` / `connectionId`; assistant
  system-event markers (`provider-switched` / `model-switched`) and
  `message.systemEvent`.
- Simplified the send pipeline to a single workspace path
  (`chatSendPipeline` / `sendChatMessage` / `retryChatTurn`); `chatContextKind`
  and the chat-http composer routing are gone.
- Removed HTTP/API-key settings (`providerSettings`, `providerModelCatalogs`,
  `providerApiKeys`, `chatHttp`, `chatModes`) from `AppSettingsState`,
  `settingsStore`, and the settings UI (Providers / Chat modes / Debug Provider
  Dev tabs). `providerSecretsStore` now stores only the OpenCode server password.
- Preserved reusable workspace-session rendering (transcript primitives,
  `ChatMessageList`, `ChatComposer`, `ToolCard`, reasoning/subtask/step/diff
  parts) and the OpenCode backend path — these feed Phase B's runtime-neutral
  session domain.
- Implementation notes and the checked removal list live in
  `specs/ops/done/01-foundation-agent-host/implementation-notes-phase-a.md`.
## 2026-10-04 12:48 MSK — Keep the local installer available

- On macOS, `build --local` now mounts and opens the finished DMG after a
  successful build. Its Finder window remains available until manually closed
  or ejected, after the temporary packaging window disappears.
- Uses only installer paths reported by the current build, including custom
  targets and paths with spaces; app-only and failed builds do not open old DMGs.
  A mount failure reports the installer path without failing the completed build.
- Validation: release helper tests cover installer opening, argument forwarding,
  app-only builds, build failures and mount failures (7 tests passed). A real
  local build succeeded and mounted the finished installer at `/Volumes/SpecOps`.

## 2026-10-04 12:47 MSK — Fix collection annotations in component builds

- Reused fresh empty-set helpers in editor pane and project search effects,
  preventing orphaned pure annotations when Svelte removes effects from the
  server build and eliminating the associated sourcemap warnings.
- Applied the same fix to the project tree context menu's default favorites
  set, removing its client-build annotation warning; clarified the collection
  helper's use for effects as well as prop defaults.
- Validation: production build passed without annotation or sourcemap warnings;
  Svelte check passed with zero errors and warnings; all eight editor tab
  keep-alive tests passed.

## 2026-10-04 12:38 MSK — Release 0.3.0

- Bumped application version from 0.2.0 to 0.3.0.

## 2026-10-04 12:35 MSK — Release helper commands

- Added `node scripts/release.mjs bump [patch|minor|major|X.Y.Z]` to
  synchronize application versions across npm, Tauri, Cargo and lockfiles,
  record the version change here and commit it on `master`.
- Added `build` to push `master` and its annotated version tag atomically,
  triggering the existing GitHub installer workflow, and `build --local`
  to run the desktop build with optional Tauri arguments.
- Release commands require a clean checkout, validate synchronized versions
  and refuse duplicate published tags, conflicting local tags and a checkout
  that does not include remote `master`. Documented usage and failure recovery.
- Validation: six isolated Git integration tests cover version changes,
  commits, dirty/staged changes, version mismatch, tag publication and remote
  divergence; added these tests to the cross-platform CI workflow. Local
  build argument forwarding passed. Markdown link checking still reports two
  existing broken links outside the changed documentation.

## 2026-10-04 12:22 MSK — Project tree navigation, Git colors and favorites

- Added a tree actions menu with Expand one level and Collapse all. Expansion
  opens the first closed level in each visible branch; collapse clears the
  persisted expansion set while retaining cached directory listings.
- Highlighted pending files and their ancestor folders in cyan, including
  changes inside closed branches. Kept change badges and added a distinct
  conflict color and `!` badge for unmerged Git entries.
- Added a collapsible Favorites section above the tree, sorted alphabetically
  with relative paths and yellow stars. Files open directly; folders reveal
  their location in the tree. Context menus add or remove favorites.
- Persisted favorites per project in shared application storage, with a
  dedicated cross-window write lock and change notifications. Favorites follow
  app-initiated renames and moves and are removed after deletion. Missing
  entries are hidden when favorites reload, including tree refreshes.
- Validation: full suite passed (3515 tests); Svelte check reported zero errors
  and warnings; production build passed. Added coverage for favorites storage,
  concurrent updates and notifications, relocation/deletion, tree actions,
  ancestor highlighting and all unmerged Git status codes.

## 2026-10-03 23:12 MSK — Complete theme appearance and expanded palettes

- Expanded the catalog from 18 to 43 themes, with 10 light options. Added
  familiar editor palettes and distinct CRT, DOS, LCD, paper, neon and drawing
  styles. A single catalog now drives selection, resolution, cycling and
  persistence; curated themes no longer disappear or fall back on restart.
- Added Palette, Typography, Layout, Effects and Preview sections with search,
  collection filters, the current theme name and isolated live previews.
- Added seven font choices, including five bundled families for offline use.
  Interface, chat and code fonts are independent; typography controls include
  sizes, line heights, letter spacing and code ligatures. Retro Latin glyphs
  use a readable size adjustment and other scripts fall back to a bundled
  monospace font.
- Added density, corners, shadows, border contrast, accent and file icon
  preferences, plus bar/block/underline editor cursors. Personal overrides
  survive palette changes; applying a full style resets overrides and restores
  custom saved sizes. Entire appearances can be saved as custom themes or
  updated in place, including their palette, style and text sizes.
- Added adjustable text glow, scanlines, screen-edge shading and paper texture.
  Optional gentle CRT shimmer defaults off and respects reduced motion.
  Effects do not capture input and are removed from printed output. Theme
  changes clear stale accents, selection overrides, effects and cursor styles.
- Improved preset text/comment/hidden-file contrast on both main surfaces and
  made range controls follow the active palette. Editors remeasure on font and
  appearance changes; zoomed editors follow the selected base size and the
  virtual project tree recalculates its row pitch after density changes.
- Fixed custom theme activation in manual mode and fallback when deleting the
  active custom theme. Saved theme styles and personal overrides are validated
  and persisted without introducing data migrations.
- Validation: 3507 tests passed; Svelte check reported zero errors/warnings;
  production build passed. Browser visual checks covered light typography,
  CRT rendering with Latin/Cyrillic, personal font priority and full-style
  application. Screenshots saved in `screenshots/appearance-typography.jpg`
  and `screenshots/appearance-crt.jpg`.

## 2026-10-03 22:37 MSK — Appearance setting previews and layout

- Added a live plain-text sample below Decorate plaintext symbols. Its
  punctuation follows the toggle and uses the editor's symbol color and opacity.
- Placed file icon samples immediately after their labels, with wrapping on
  narrow panes. Moved Mode directly above theme selection and sized its
  segmented control to its contents.

## 2026-10-01 16:02 MSK — Theme preview grid

- Replaced theme selection rows with a responsive grid of cards showing a
  text and syntax sample beside a miniature project tree, with names below.
- Preview palettes are isolated per card, including derived colors, gradients,
  light/dark file icon colors and live custom-theme edits. Selection has a
  border, checkmark and keyboard focus; Duplicate remains a separate action.
- Preserved Manual selection and independent Light/Dark choices in Auto.
  Verified selection, duplication, custom gradients and responsive rendering.

## 2026-10-01 14:57 MSK — Selectable file icon colors

- Added Color and Monochrome file icon choices with sample symbols in Themes.
  The selection applies immediately to the project tree and new-file drafts,
  persists in app settings, and defaults to Color.
- Preserved the existing symbol shapes in both modes. Replaced `light-dark()`
  icon colors with explicit light/dark palette variables so colored symbols
  do not depend on support for that CSS function in the desktop WebView.
- Covered appearance switching, settings persistence and draft rendering.

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
