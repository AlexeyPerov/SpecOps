# Git parser fixtures

Sample `stdout` captured from real `git` invocations for parser tests. Regenerate in a temp repo when formats change.

| File | Git command |
|---|---|
| `git-log-format.txt` | `git log --no-show-signature --decorate=full --format=%H%x00%P%x00%D%x00%aN±%aE%x00%at%x00%cN±%cE%x00%ct%x00%s` |
| `git-branch-vv.txt` | `git branch -vv` |
| `git-tag-list.txt` | `git tag -l` |
| `git-status-porcelain.txt` | `git status --porcelain` |

## Regeneration notes

Log format uses NUL (`\0`) field separators and `±` between author/committer name and email (same structured format planned for phase 2 commit queries). Branch fixture was captured from a repo with `master` and `feature/login`. Status fixture mixes modified and untracked porcelain lines.
