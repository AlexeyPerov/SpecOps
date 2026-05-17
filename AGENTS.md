# Agent rules

- **Changelog.** Log all changes to `specs/changelog.md`. Create that file if it does not exist. Use dated (with time) entries or an existing section style already used in that file.

- **References.** Do not make any changes to files in `references/` folder. They are git ignored and used only as an example.

- **Migrations.** Do not implement data migrations, compatibility shims, or upgrade paths for persisted data unless explicitly requested. The app is in active development and is not used by real users yet; prefer simplifying storage and codecs over backward compatibility.
