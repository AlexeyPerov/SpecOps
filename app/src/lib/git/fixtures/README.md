# Git parser fixtures

Sample `stdout` captured from real `git` invocations for parser tests. Regenerate in a temp repo when formats change.

| File | Git command / topology |
|---|---|
| `commit-graph-linear.json` | Five-commit single-parent chain (newest-first) for graph layout unit tests |
| `commit-graph-merge.json` | Feature branch merged into main — merge commit plus 8 other commits |
| `commit-graph-truncated.json` | Log window cutoff — parent SHA referenced but not present in commit array |
| `git-log-format.txt` | `git log --no-show-signature --decorate=full --format=%H%x00%P%x00%D%x00%aN±%aE%x00%at%x00%cN±%cE%x00%ct%x00%s` |
| `git-branch-vv.txt` | `git branch -vv` |
| `git-show-name-status.txt` | `git show --name-status --format=%H%x00%P%x00%aN%x00%aE%x00%at%x00%cN%x00%cE%x00%ct%x00%B` |
| `git-tag-list.txt` | `git tag -l` |
| `git-remote-vv.txt` | `git remote -v` |
| `git-ls-remote-tags.txt` | `git ls-remote --tags <remote>` |
| `git-status-porcelain.txt` | `git status --porcelain` |
| `git-diff-unified-single-file.txt` | `git diff --no-color --no-ext-diff --patch --unified=3 HEAD -- <file>` |
| `git-diff-binary.txt` | `git diff --no-color --no-ext-diff --patch --unified=3 <parent>..<sha> -- <binary>` |
| `git-diff-multi-file.txt` | `git diff --no-color --no-ext-diff --patch --unified=3 <parent>..<sha>` (two files) |

## Regeneration notes

Log format uses NUL (`\0`) field separators and `±` between author/committer name and email (same structured format planned for phase 2 commit queries). Branch fixture was captured from a repo with `master` and `feature/login`. Status fixture mixes modified and untracked porcelain lines.

## Integration tests and CI

Parser **unit** tests use the fixture stdout files above and do not require `git` on PATH.

**Integration** tests (`gitIntegration.test.ts`, integration sections in `gitParse.test.ts`, and Rust tests in `app/src-tauri/src/git.rs`) create temporary repositories and shell out to system `git`.

| Environment | Strategy |
|---|---|
| **Local dev** | Run `npm test` with `git` installed (recommended). Integration suites exercise real `git log`, `git status`, and `git show` output against temp repos. |
| **CI without git** | TypeScript integration suites use `describeIfGitInstalled` from `test/gitTempRepoHarness.ts` and register as **skipped** when `git --version` fails — the job stays green. |
| **CI with git (all platforms)** | `.github/workflows/test.yml` runs `npm test` on `ubuntu-latest`, `macos-latest`, and `windows-latest`. All three runners include git on PATH; integration suites execute fully. |
| **Release builds** | macOS and Windows release runners include git; integration tests run normally. Rust `cargo test` in `src-tauri` also requires git for subprocess tests. |

To require git in CI later, replace `describeIfGitInstalled` with plain `describe` and add an explicit `git --version` setup step to the workflow.
