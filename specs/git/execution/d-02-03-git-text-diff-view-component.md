# D-02 Task 3 — Git text diff view component [DONE]

**Branch policy:** Agents must **not** create a new branch for this task; commit and push directly to `master` unless the user explicitly requests otherwise.

**Backlog:** [D-02](../backlog.md)  
**Prior task:** [d-02-02-query-commit-file-diff-service.md](./d-02-02-query-commit-file-diff-service.md)  
**Reference project:** [local checkout](file:///Users/alexeyperov/Projects-Archive/sourcegit-master) · [GitHub sourcegit-scm/sourcegit](https://github.com/sourcegit-scm/sourcegit)

**Score:** 8 · **Agent:** heavy · **Estimate:** ~1.5d

## Goal

Build a unified (single-pane) text diff viewer component with hunk headers, +/- line styling, and line numbers — MVP scope excludes side-by-side and syntax highlighting.

## Required context

1. `ParsedTextDiff` / `DiffLine` types
2. Reference unified view: [`TextDiffView.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/TextDiffView.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/TextDiffView.axaml) — combined presenter template
3. Reference toolbar/summary: [`DiffView.axaml`](file:///Users/alexeyperov/Projects-Archive/sourcegit-master/src/Views/DiffView.axaml) · [GitHub](https://github.com/sourcegit-scm/sourcegit/blob/master/src/Views/DiffView.axaml) — added/deleted counts, file title
4. App monospace / editor tokens used in existing panels

## Implementation steps

1. Create `app/src/lib/components/GitTextDiffView.svelte` props:
   - `diff: ParsedTextDiff | null`
   - `title?: string`
   - `loading?: boolean`
   - `error?: string | null`
2. Layout:
   - Header row: file path, `+N` / `-M` summary (green/red, match DiffView pattern)
   - Scrollable body: table or div grid with columns `[oldNo | newNo | prefix | content]`
   - Style added lines with green background token; deleted with red; context default
   - Hunk headers (`@@ ... @@`) muted monospace
3. Use `font-family: var(--font-mono)` or existing editor font variable from app shell.
4. Empty state when `diff` is null: “Select a file to view changes”.
5. **Out of scope for this task:** word wrap toggle, minimap, side-by-side, syntax highlighting, external diff tool — note in component doc comment.
6. Run Svelte autofixer until clean.

## Acceptance checklist

- [ ] Renders fixture diff with correct line numbers and colors.
- [ ] Loading and error props display without layout shift.
- [ ] Long lines scroll horizontally (no forced wrap unless easy `overflow-x: auto`).
- [ ] Accessible: hunk content in `<pre>` or `role="region"` with `aria-label` including file path.

## Dependencies

- [d-02-02-query-commit-file-diff-service.md](./d-02-02-query-commit-file-diff-service.md)

## Changelog

When done: mark title with `[DONE]`; add entry to top of `specs/changelog.md`.
