# Git integration — fix execution plans

Execution plans from the **2026-07-04 git integration code review**. Each file is a self-contained task (or logical group) sorted by priority.

| ID | Priority | Title | File |
|---|---|---|---|
| FIX-01 | P0 | Autosave before working-tree mutations | [fix-01-autosave-before-working-tree-mutations.md](./fix-01-autosave-before-working-tree-mutations.md) |
| FIX-02 | P0 | System git project-tree badges | [fix-02-system-git-project-tree-badges.md](./fix-02-system-git-project-tree-badges.md) |
| FIX-03 | P1 | Remote auth and non-interactive env | [fix-03-remote-auth-and-non-interactive-env.md](./fix-03-remote-auth-and-non-interactive-env.md) |
| FIX-04 | P1 | Ahead/behind error handling | [fix-04-ahead-behind-error-handling.md](./fix-04-ahead-behind-error-handling.md) |
| FIX-05 | P1 | Workspace Manager git column refresh | [fix-05-workspace-manager-git-column-refresh.md](./fix-05-workspace-manager-git-column-refresh.md) |
| FIX-06 | P1 | Per-repo git command queue | [fix-06-per-repo-git-command-queue.md](./fix-06-per-repo-git-command-queue.md) |
| FIX-07 | P2 | Git probe and status performance | [fix-07-git-probe-and-status-performance.md](./fix-07-git-probe-and-status-performance.md) |
| FIX-08 | P2 | Pull dirty-tree UX | [fix-08-pull-dirty-tree-ux.md](./fix-08-pull-dirty-tree-ux.md) |
| FIX-09 | P2 | Cancellation breadth and subprocess timeout | [fix-09-cancellation-and-subprocess-timeout.md](./fix-09-cancellation-and-subprocess-timeout.md) |
| FIX-10 | P2 | gitService modularization | [fix-10-gitservice-modularization.md](./fix-10-gitservice-modularization.md) |
| FIX-11 | P2 | Porcelain v2 status parsing | [fix-11-porcelain-v2-status-parsing.md](./fix-11-porcelain-v2-status-parsing.md) |
| FIX-12 | P2 | Stash panel UI | [fix-12-stash-panel-ui.md](./fix-12-stash-panel-ui.md) |
| FIX-13 | P2 | Windows git PATH fallback | [fix-13-windows-git-path-fallback.md](./fix-13-windows-git-path-fallback.md) |
| FIX-14 | P3 | Git integration polish | [fix-14-git-integration-polish.md](./fix-14-git-integration-polish.md) |

**Related existing plans:** [D-05 askpass](../d-05-01-askpass-command-and-credential-request-flow.md) (FIX-03 extends); [S-01 backlog](../../backlog.md) (FIX-02 implements).

**Branch policy:** Commit and push directly to `master` unless the user explicitly requests a branch or PR workflow.
