# Desktop acceptance evidence

Captured 2026-10-17, Europe/Volgograd (UTC+03), on macOS 14.4 (23E214), Retina devicePixelRatio 2. These are screenshots of the real Tauri application running real Git commands. No browser fixture or mocked screenshot harness was used. The isolated bundle identifier is `com.alexeyperov.specops.acceptance`; the ordinary application profile was not used.

## Viewport and appearance

The `1440`, `1920`, `1024`, and `800` screenshot names denote measured **CSS WebView viewports** 1440×900, 1920×1080, 1024×768, and 800×600. Native Tauri window sizing was followed by `innerWidth`/`innerHeight` measurement in Web Inspector with the inspector closed; PNG dimensions include native chrome and Retina scaling. Dark captures use the application dark palette (Turnip); light captures use Blue. Interface and editor size are 100%, except the explicit `125percent` capture made using the application's Interface size setting, then restored. All four views were captured at each target viewport; additional 1440 light captures cover the alternate theme. `push-800-light-footer` records keyboard access to the modal footer after scrolling.

The final primary runtime remount, offline and final navigation captures use measured 1920×1080 CSS px at DPR2 and zoom 1 (reconfirmed in the final rebuilt app). The secondary window uses OS window zoom (PNG 5120×2530 physical pixels); its CSS viewport was not separately measured, so it is not counted as a target-size capture. Their accompanying accessibility transcripts are the primary state evidence. Earlier target-size captures prove layout; they predate only the runtime state retention/idempotent navigation fix, which does not change layout styles. `baseline-history-after-remount` is explicitly a post-remount baseline screenshot at its default depth, not evidence of 5000 loaded commits.

## Results

| Check | Result | Evidence / method |
| --- | --- | --- |
| History / Changes / Pull / Push at all four CSS viewports | passed | Dated PNGs below; native light/dark application, not image scaling |
| Four-area history composition, splitters, table-local overflow and modal scrolling | passed | History PNGs; sidebar flex growth, wrapped status/diff header, border token and Push legend defects fixed |
| Light/dark and increased interface size | passed | 1440 light/dark series; `history-1440-light-125percent` |
| Empty repository, no remote | passed | `empty-no-remotes-1440-light`; disabled remote controls and empty history |
| Detached HEAD, nested/long refs | passed | `detached-history-1440-light`; synthetic detached branch rows excluded; navigation ellipsis / title retained |
| Bare repository | passed | `bare-history-1440-light`; actual bare Git directory resolves; refs/history available without worktree/stash/recovery queries |
| Mouse and keyboard: ref → commit → file → diff, split arrow/Home keys, modal Tab/Escape/focus return | passed | Native actions plus mounted navigation/split/history/inspector/dialog tests; narrow footer capture |
| Changes → Stage all → Commit | passed | Actual temporary repo commit `eb8a76ff6cff99f03d4b6352a1ed6ccdefe21be3`; notes/README visible in final selected commit |
| Actual Push to disposable local bare origin | passed | `push-result-1920-dark`; selected main ref succeeded; no user repository remote was mutated |
| Pull/Push options, tracking, rejected/partial refs, cancellation/queue | passed | Real temporary Git integration tests plus native contract/process tests; mounted focus/validation/error coverage |
| Offline/error | passed | Actual loopback connection refusal in `pull-offline-light`; Pull disabled and Cancel usable; temporary origin restored afterwards |
| Authentication and running/cancel states | passed (controlled runner) | Existing native/auth/remote runner and mounted tests; no real credentials/accounts required |
| Live provider login / real network account | not-run | No account or credentials used; controlled auth contract coverage above |
| Resize / layout restart persistence | passed | Real native resizing and app restart restored valid split sizes; mounted storage clamp/isolated key tests |
| Workspace and secondary native window isolation | passed | Final `primary-before-secondary` / `primary-after-secondary`: same SHA `eb8a76ff6cff`, depth 5000, navigation 523px and filter `feature`; second empty repo resized separately, then closed. Clearing filter restored collapsed Branches (`navigation-collapse-restored`) |
| Changes draft and active diff across shell/workspace remount | passed | `changes-remount-light` PNG/text; draft and notes.txt diff retained after adding another workspace; mounted reactive same-repository workspace switch and late commit tests |
| External Git changes / scope readiness / late replies | passed | Native branch/detached/remote configuration refresh, `scope-ready.txt`; mounted stale responses, repeated same ref/History, reactive scope and busy teardown regressions |
| 5000+ branching history / DOM / SVG / timings / load cap | passed with stated limits | Real 5212-commit fixture, native before/after JSON measurements below; table rows windowed, SVG remains proportional to loaded commits |
| Full Git parity outside this package | not-run | Partial staging, merge editor, interactive rebase, LFS and other unrequested features remain outside scope |

## Performance

Both runs use the same disposable branching repository, All branches, remote refs off, and measured CSS viewport 1920×1080. The baseline uses its original Git ordering; the current build uses topological order. The baseline is a genuine isolated native build of pre-layout commit `5ea9e4b`, created in a detached temporary checkout. The current build includes GL01–08. Both load 5000 of 5212 commits; maximum load 5000 is visibly explained and Jump to SHA/ref accesses older ancestry. Counts are scoped to the visible Git view, avoiding hidden workspace panels.

| Metric | Baseline | Current |
| --- | --- | --- |
| Rendered history rows at sampled scroll position | 58 | 39 |
| SVG elements in history | 5002 | 5002 |
| DOM elements in visible Git view | 5600 | 5556 |
| Selection to two animation frames, n=3, ms | 34,33,33 | 33,29,33 |
| Selection to native metadata ready, n=3, ms | 84,66,67 | 86,80,80 |
| Scroll to two animation frames, n=3, ms | 33,33,34 | 36,33,34 |
| Nine successive Load more page waits, ms | 139,145,181,211,228,261,289,307,329 | 164,187,199,222,260,284,317,334,374 |

The measurement script clicks actual native WebView UI handlers, polls loading/metadata, uses `performance.now()` and two requestAnimationFrame callbacks, and reads DOM/SVG counts from the visible history panel and its enclosing Git view. Selection samples choose adjacent loaded stress commits; scroll samples use scrollTop 30000, 60000, 80000. JSON contains raw samples. This small sample is diagnostic, not a statistical benchmark. Baseline default row density differs from current Compact mode and baseline uses dark/current light; those differences limit direct comparison. Selection paint remains comparable; metadata median is 13 ms higher (80 vs 67), and last page 45 ms higher (374 vs329). No material stall was observed, but the figures do not prove every operation is faster or guarantee the absence of all regressions. **Only table rows are virtualized; the full SVG graph is not.**

## Commands and validation

Run from `app/`:

```sh
npm test
npm run check
npm run build
npm run tauri -- build --debug --bundles app --config '{"identifier":"com.alexeyperov.specops.acceptance","productName":"SpecOps Acceptance"}'
cd src-tauri
cargo test -- --test-threads=1
```

Full frontend suite: 306 files / 3114 tests passed. Svelte/type check: 0 errors / 0 warnings. Production frontend and host build, debug native app bundle: passed. Native full suite: 122 passed, 0 failed, 1 ignored. The initial parallel native run had one unrelated filesystem Busy failure in component-manager crash-boundary coverage; the full serial suite passed, and that unrelated component was not changed. Existing compiler unused-code and Rollup annotation warnings remain non-failing. Svelte MCP documentation and autofixer checks were run for touched components, repeated after changes: no issues; effect/state suggestions were reviewed as async Git and scoped lifecycle synchronization.

The real-repository tests include `gitPull.integration.test.ts`, `gitPush.integration.test.ts`, native Git tests and the new bare/non-repository probe integration test. Mounted regressions cover remount depth/scroll/selection, navigation collapse/filter/focus, draft/active diff, successful commit after unmount, reactive roots sharing one repository, old busy/mutation callbacks, and non-worktree scope transitions. Runtime state is capped at 128 workspace/window entries, stores no commit arrays, and is not a persisted-data migration. Restart persistence applies to layout preferences; runtime selection/drafts are retained within the application process, not claimed durable across full process exit.

The isolated fixture roots are under `~/.codex/tmp/specops-git-acceptance/`: worktree `workspace`, bare origin `remote.git`, and empty `empty`. All author/branch/message content is synthetic. The detached baseline checkout was removed after capturing evidence; no baseline source change was made in the current checkout. The disposable fixture repositories remain for reproduction.

Startup project-favorites notices and existing font CSP console messages also appeared in the isolated builds; they did not block Git acceptance and were not changed as part of this package.

## Captures and raw results

- [2026-10-17-bare-history-1440-light.png](2026-10-17-bare-history-1440-light.png)
- [2026-10-17-baseline-history-1920-dark.png](2026-10-17-baseline-history-1920-dark.png)
- [2026-10-17-baseline-history-after-remount-1920-dark.png](2026-10-17-baseline-history-after-remount-1920-dark.png)
- [2026-10-17-baseline-performance.json](2026-10-17-baseline-performance.json)
- [2026-10-17-changes-1024-dark.png](2026-10-17-changes-1024-dark.png)
- [2026-10-17-changes-1440-dark.png](2026-10-17-changes-1440-dark.png)
- [2026-10-17-changes-1440-light.png](2026-10-17-changes-1440-light.png)
- [2026-10-17-changes-1920-dark.png](2026-10-17-changes-1920-dark.png)
- [2026-10-17-changes-800-light.png](2026-10-17-changes-800-light.png)
- [2026-10-17-changes-remount-light.png](2026-10-17-changes-remount-light.png)
- [2026-10-17-changes-remount-light.txt](2026-10-17-changes-remount-light.txt)
- [2026-10-17-current-performance.json](2026-10-17-current-performance.json)
- [2026-10-17-detached-history-1440-light.png](2026-10-17-detached-history-1440-light.png)
- [2026-10-17-empty-no-remotes-1440-light.png](2026-10-17-empty-no-remotes-1440-light.png)
- [2026-10-17-history-1024-dark.png](2026-10-17-history-1024-dark.png)
- [2026-10-17-history-1440-dark.png](2026-10-17-history-1440-dark.png)
- [2026-10-17-history-1440-light-125percent.png](2026-10-17-history-1440-light-125percent.png)
- [2026-10-17-history-1440-light.png](2026-10-17-history-1440-light.png)
- [2026-10-17-history-1920-dark.png](2026-10-17-history-1920-dark.png)
- [2026-10-17-history-5000-1920-light.png](2026-10-17-history-5000-1920-light.png)
- [2026-10-17-history-800-light.png](2026-10-17-history-800-light.png)
- [2026-10-17-navigation-collapse-restored.txt](2026-10-17-navigation-collapse-restored.txt)
- [2026-10-17-primary-after-secondary.png](2026-10-17-primary-after-secondary.png)
- [2026-10-17-primary-after-secondary.txt](2026-10-17-primary-after-secondary.txt)
- [2026-10-17-primary-before-secondary.txt](2026-10-17-primary-before-secondary.txt)
- [2026-10-17-pull-1024-dark.png](2026-10-17-pull-1024-dark.png)
- [2026-10-17-pull-1440-dark.png](2026-10-17-pull-1440-dark.png)
- [2026-10-17-pull-1440-light.png](2026-10-17-pull-1440-light.png)
- [2026-10-17-pull-1920-dark.png](2026-10-17-pull-1920-dark.png)
- [2026-10-17-pull-800-light.png](2026-10-17-pull-800-light.png)
- [2026-10-17-pull-offline-light.png](2026-10-17-pull-offline-light.png)
- [2026-10-17-pull-offline-light.txt](2026-10-17-pull-offline-light.txt)
- [2026-10-17-push-1024-dark.png](2026-10-17-push-1024-dark.png)
- [2026-10-17-push-1440-dark.png](2026-10-17-push-1440-dark.png)
- [2026-10-17-push-1440-light.png](2026-10-17-push-1440-light.png)
- [2026-10-17-push-1920-dark.png](2026-10-17-push-1920-dark.png)
- [2026-10-17-push-800-light-footer.png](2026-10-17-push-800-light-footer.png)
- [2026-10-17-push-800-light.png](2026-10-17-push-800-light.png)
- [2026-10-17-push-result-1920-dark.png](2026-10-17-push-result-1920-dark.png)
- [2026-10-17-scope-ready.txt](2026-10-17-scope-ready.txt)
- [2026-10-17-secondary-window-light.png](2026-10-17-secondary-window-light.png)
- [2026-10-17-secondary-window-light.txt](2026-10-17-secondary-window-light.txt)
- [2026-10-17-validation.txt](2026-10-17-validation.txt)
- [2026-10-17-history-repeat-navigation.txt](2026-10-17-history-repeat-navigation.txt)
- [2026-10-17-history-final-1920-light.png](2026-10-17-history-final-1920-light.png)
- [2026-10-17-viewport.json](2026-10-17-viewport.json)
