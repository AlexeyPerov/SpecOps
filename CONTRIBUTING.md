# Contributing to SpecOps

Thanks for helping improve SpecOps. This project is under active development; prefer simple, SpecOps-native changes over compatibility shims.

## Setup

Prerequisites: Node.js 24+ (see [`.nvmrc`](./.nvmrc)), Rust (stable), and system `git` on `PATH`.

```sh
cd app
npm ci
npm run tauri dev
```

Use `npm ci` for a reproducible checkout. Use `npm install` when intentionally
changing dependencies or updating `package-lock.json`.

See the root [README.md](./README.md) for build, port **1430**, and CI release notes.

## Checks

These are the merge-gate checks. CI runs all of them on every pull request and
`master` push (Vitest on macOS/Windows/Linux; typecheck, Rust tests, and the
Markdown link checker on Linux).

From `app/`:

```sh
npm test
npm run check
```

Rust tests from `app/src-tauri/`:

```sh
cargo test
```

Tracked Markdown link check from the repo root (relative links and anchors
against `git ls-files`; external URLs are skipped):

```sh
node scripts/check-markdown-links.mjs
```

## Documentation

| Audience | Start here |
| --- | --- |
| Users / setup | [docs/README.md](./docs/README.md), [docs/opencode-integration.md](./docs/opencode-integration.md) |
| Codebase map | [docs/architecture.md](./docs/architecture.md) |
| Agent rules | [AGENTS.md](./AGENTS.md) |

Keep user-facing setup in `docs/`. Put plans, milestones, and the dated changelog in `specs/`.
Do not link public docs at the root or under `docs/` into gitignored / untracked
`specs/` paths — the Markdown link checker enforces that for clean clones.

## Changelog

Log user-visible or structural changes in [`specs/changelog.md`](./specs/changelog.md) using the existing dated-entry style.

## Branching

Unless maintainers ask otherwise, commit and push directly to `master` (see [AGENTS.md](./AGENTS.md)). Do not open drive-by feature branches or PRs by default.

## Persistence

Do not add data migrations or upgrade paths for on-disk formats unless explicitly requested. Prefer simplifying codecs and storage.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).
