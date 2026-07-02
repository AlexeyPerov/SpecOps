# Agent rules

- **Changelog.** Log all changes to `specs/changelog.md`. Use dated (with time) entries or an existing section style already used in that file.

- **Migrations.** Do not implement data migrations, compatibility shims, or upgrade paths for persisted data unless explicitly requested. The app is in active development and is not used by real users yet; prefer simplifying storage and codecs over backward compatibility.

- **Reference projects.** Specs may link to external reference codebases (local paths and upstream GitHub URLs) for design and behavior examples. In **commits, changelog entries, code comments, user-visible strings, and identifiers** in this repo, do **not** use reference-project product names, codenames, or their internal file/type/command names (e.g. as copy-paste labels or “ported from X” attribution). Implement SpecOps-native naming and describe behavior in generic terms. Reference repos are for understanding logic and UX patterns only—not for traceability in shipped artifacts.
