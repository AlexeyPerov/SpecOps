> Historical pre-implementation note. Its default-light label was unverified/incorrect; the main report and captured computed theme values supersede it. Later instrumented before-counts and matched runs are documented separately.

# Workspace baseline — 2026-10-18 17:23 UTC+03

Source: 102efe9f8b37a5539d8e6487aa3f8e2df03c8c35, archived under source before implementation began. Native bundle built from that archive using debug Tauri + production frontend, identifier com.alexeyperov.specops.workspacesbaseline, product SpecOps Workspaces Baseline. Build native-build.log. Ordinary application profile untouched.

Machine: Apple M2 Max, 32 GiB RAM, macOS 14.4 (23E214), WebKit native WebView, DPR 2. Measured viewport 800×1020 CSS px; rail expanded 240 CSS px, narrow 64 CSS px. Screenshots are full native window pixels (1600×2040), not image-scaled browser fixtures. Interface default 100%, default light theme. Other applications remained running; no system cache purge, no CPU isolation.

Reproduction: python3 create-fixture.py /unused/path creates manifest + 30 projects in five logical groups. Script refuses to overwrite existing data. Current fixture /tmp/specops-workspaces-fixture. 5 pinned and 3 hidden flags in manifest, same names across groups, long name/path, missing directory, non-Git directory, unborn/detached/conflicted Git, linked worktree, and 5000 untracked files. Baseline has no logical folder/pin/catalog support, so those flags cannot be exercised in baseline. seed-baseline.py 30 or 5 writes only the isolated profile (app must be stopped); fixture path is currently fixed in that helper.

| Measurement | 30 contexts | 5 contexts | Repeats / meaning |
| --- | --- | --- | --- |
| startup runtime ready | 176 ms | 138 ms | n=1 each, built-in startup.total / runtime-ready log |
| startup initialized | 195 ms | 156 ms | n=1 each, same startup.total name with initialized message |
| DOM navigation load | 170 ms | not captured | n=1, WebView load event, not OS cold launch |
| Manager click → two animation frames | 100 ms | not captured | n=1, opening actual Manager with 30 rows; does not wait for Git |
| native workspace.switchRestore | 1,1,2,2,2 ms | startup sample 4 ms | 30-context samples from native pointer activation, 5 unique first visits; warm revisits do not produce fresh restore log |
| native main process RSS | see baseline-30.json | 92640 KiB | n=1 each at differing lifecycle times; excludes WebKit renderer and cannot establish total-memory regression |

Twenty pointer activations across first five projects were performed in the actual narrow rail. Only five native restore metric events were published: these measure restore service completion, not input-to-paint nor file-buffer restoration. Empty fixture snapshots restore an Untitled tab; this does not establish behavior for large open buffers. Five native samples are insufficient for a robust p95 or ±10% regression assertion. The earlier synthetic element.click() rail samples in baseline-30.json are deliberately marked discarded: baseline draggable rows activate on pointer release and synthetic click did not switch workspace. They must never be used as a baseline timing.

Screenshots baseline-expanded.png, baseline-narrow.png show actual rail around workspace editor; baseline-manager.png and baseline-manager.txt show actual Manager, including linked/detached/non-Git/missing rows. baseline-5.png proves five-context restoration. Missing path produced expected native watcher warning. Existing project-favorites warning appeared on empty isolated profile.

Not measured: OS/process cold launch, first rail paint, exact subprocess count/max concurrency, exact watcher count, renderer/total memory. No diagnostic endpoint exposing native watcher/process counts exists in baseline. Do not infer those counts from JS requests, ps sampling, or source alone. Closed catalog scenario/search unavailable in original baseline by design. Multiwindow, storm/external branch/focus/restart cycles remain final acceptance work. Native bundle and source archive preserved outside git for matched reruns after implementation.

Frontend baseline provided by orchestrator: 307 files / 3125 tests passed (34.15s), check 0 errors/0 warnings, production build passed; corresponding logs in this directory. No implementation or repository changes were made by baseline work.
