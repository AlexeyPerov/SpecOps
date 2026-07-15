# Text Editor Parity v3 — Roadmap

**Status:** Complete — 9 of 9 milestones complete
**Product position:** SpecOps remains a notes/specs workspace with AI. This
roadmap adds enough general-purpose editing capability that users should rarely
need a second text editor for routine work; it does not pursue full
general-purpose editor or IDE parity.

## How to use this roadmap

1. Execute milestones in the order below unless the dependency graph permits parallel work.
2. Give an agent **one execution-plan file at a time**. Each plan is sized to be independently reviewable and ends with its own validation gate.
3. Within a plan, complete tasks in listed order and mark completed task headings with `[DONE]`.
4. Add every implementation or planning change to the top of `specs/changelog.md` with date and time.
5. From `app/`, run the tests named by the plan plus `npm test` and `npm run check`.

## Complexity scale

| Level | Typical score | Meaning |
|---|---:|---|
| Easy | 1–3 | Local change with established patterns |
| Medium | 4–6 | Several modules or moderate interaction/state work |
| Heavy | 7–8 | Cross-cutting editor lifecycle, async indexing, or complex UX |
| Very heavy | 9–10 | Broad architectural risk; split before assignment |

Scores estimate implementation/review complexity, not elapsed time.

## Milestones

| Milestone | Status | Outcome | Plans | Complexity |
|---|---|---|---:|---|
| [M0 — Editor foundations](./m0-editor-foundations/) | Complete | Refactor editor sessions/runtime/extensions/overlay/indexing boundaries before features | 6 | Heavy (8) |
| [M1 — Fuzzy file open](./m1-fuzzy-file-open/) | Complete | `Cmd/Ctrl+P` workspace file picker with fast fuzzy ranking | 2 | Heavy (7) |
| [M2 — Multiple selections](./m2-multiple-selections/) | Complete | Multi-cursor, select-next occurrence, skip/undo occurrence, column selection | 2 | Medium (6) |
| [M3 — Command palette](./m3-command-palette/) | Complete | Searchable, context-aware command launcher | 2 | Medium (6) |
| [M4 — Folding and Markdown outline](./m4-folding-markdown-outline/) | Complete | Code folding plus heading navigation for long specs | 2 | Heavy (7) |
| [M5 — Typing assistance](./m5-typing-assistance/) | Complete | Auto-close pairs and local document-word completion | 2 | Medium (6) |
| [M6 — Markdown snippets](./m6-markdown-snippets/) | Complete | Built-in and user-defined reusable spec templates | 2 | Medium (6) |
| [M7 — Document landmarks](./m7-document-landmarks/) | Complete | Quick heading jump plus document-local bookmarks | 2 | Medium (6) |
| [M8 — Find/replace polish](./m8-find-replace-polish/) | Complete | Whole-word/regex search, selection seeding, consistent project search | 2 | Heavy (7) |

## Recommended execution order

```text
M0.1 → M0.2 → M0.3 → M0.4 → M0.5 → M0.6
                                      ├─→ M1 → M2
                                      └─→ M3
M1 + M2 + M3 → M4 → M5 → M6 → M7 → M8
```

M1 and M3 may run in parallel after M0.6 if separate agents avoid simultaneous edits to `AppShell.svelte`, command definitions, and shared picker components. M2 can proceed after M0.4, but sequencing it after M1 reduces merge pressure on editor plumbing.

## Architectural findings behind M0

- `EditorSurface.svelte` owns CodeMirror construction, six extension compartments, document/language synchronization, scroll persistence, command-runner publication, and cursor reporting.
- `EditorCommandRunner` is a growing hand-written facade passed through `DocumentEditor.svelte` → `MarkdownEditorPane.svelte` → `EditorPaneContent.svelte` → `AppShell.svelte` → `+page.svelte`.
- One `EditorView` is reused when a pane switches documents, so selection, undo history, and future fold/completion/bookmark fields are pane-scoped instead of document-scoped.
- The single mutable runner has no pane/document generation identity or explicit unregister token, allowing stale registrations to race active-pane changes.
- `DocumentEditor.svelte`, `MarkdownEditorPane.svelte`, and `FindReplacePanel.svelte` still use legacy Svelte props/reactivity while their parents use Svelte 5 runes.
- Editor chrome state is split between global `appState.editor`, pane-level props, and route-local fields.
- Global key routing has command-specific exceptions and contenteditable guards; palettes and editor-native shortcuts need explicit precedence rules.
- Workspace traversal is duplicated between project-tree loading and `collectOpenableFolderFiles`; project search performs a fresh serial full walk for each search.
- Existing modal/list components duplicate focus, Escape, active-row, and keyboard-selection behavior.

M0 is behavior-preserving except for fixing editor-session isolation and related stale-registration defects. New editor ephemera remains in memory; persisted-data migrations or compatibility shims are explicitly out of scope.

## Product-wide acceptance criteria

- Routine text/Markdown tasks can be completed without opening another editor.
- New features work in every text editor pane and target the active pane only.
- Markdown preview, split view, minimap, tab transfer, external-file reload, and multi-window behavior do not regress.
- Commands are discoverable in Shortcuts settings and the command palette, with platform-correct bindings.
- Keyboard-only workflows and screen-reader semantics are covered in each overlay plan.
- Large workspaces remain responsive: expensive enumeration/ranking is cancellable, cached, or bounded.
- No general plugin system, LSP, build system, macro recorder, or extreme huge-file parity is introduced by this roadmap.

## Shared implementation rules

- Prefer CodeMirror 6 primitives over custom selection/folding/completion engines.
- Add `@codemirror/search` and `@codemirror/autocomplete` as direct dependencies when their public APIs are first imported, even though they are currently transitive dependencies.
- Keep domain/ranking/parser logic in pure TypeScript with colocated Vitest tests.
- Keep Svelte components presentational where practical; use Svelte 5 runes for new or touched components.
- Preserve the existing `AppCommandId` → definition → handler → menu/shortcut pipeline.
- Do not persist ephemeral selections, folds, completion state, picker queries, or bookmarks unless a plan explicitly says otherwise.
- Do not add migrations for settings or session storage.

