# Workspace documents, windows and project operations

## Tab groups

Each window keeps an ordered list of tab groups above its workspaces in the sidebar. The default group ("Tabs") exists from the first launch and cannot be deleted; it stays first. The sidebar's "+" creates a group ("Tabs 2", "Tabs 3", … or a typed name) and activates it. A group's menu offers Rename and Delete (disabled for the default group). Expanded rows show the name, the tab count and the last three saved files, which open their tab directly; compact rows show the default group's icon or the group's initial.

A tab group is a window context like a workspace, without a project root: its own panes, tabs and buffers. Files opened outside the active workspace, the Workspace Manager and files saved outside their workspace land in the active group, otherwise in the window's last used group, otherwise in the default group. Closing the last workspace activates that same group. Dragging a file tab onto a group row moves it there with its unsaved buffer; a dirty buffer is not moved onto a copy of the same file already open in the group. Dropping files from disk or the project tree onto a group row opens them in that group.

Deleting a group with unsaved buffers asks to Save all or, after a second confirmation, discard them; files on disk are untouched. Deleting the active group activates the default group. Groups and their buffers are stored in the window session snapshot and disappear with the window. Window snapshots from before tab groups (a single `notepad` context) are not restored.

## Tasks and Notes

Each workspace has one optional Notes document and one optional Tasks document. The workspace menu offers Create/Open Tasks and Notes, and existing documents have pinned links above the project tree.

App-wide Tasks and Notes documents are listed in their own sidebar sections below the tab groups in both widths. They are shared across all windows and independent of any workspace. There are none by default; each section's "+" creates one with a typed name or "Tasks"/"Notes" (then "Tasks 2", …) and opens it. A document's menu offers Open, Rename, Move Up, Move Down and Delete. Delete asks for confirmation, removes the catalog entry, closes the document's tabs in every window and deletes its files. A document opens as one tab per document, named after the document, in the active tab group, or in the window's last used tab group while a workspace is active. A tab whose document was deleted elsewhere shows that state instead of recreating the file.

Opening a missing document shows an editable empty task book or notes editor. Viewing, refreshing, saving an untouched empty view, or typing an unsubmitted task/list/group draft does not create a file; the first committed edit creates it.

Notes remain plain Markdown with an editable source and sanitized preview. Tasks use a version-1 JSON task book with stable IDs, named lists and one level of groups. Lists can also remain ungrouped. Groups, lists and tasks support creation, renaming/editing, deletion and manual ordering. Tasks support completion and transfer between lists; lists can move between groups. Transfers keep IDs and append to the destination. Deleting a group keeps its lists and tasks ungrouped. Deleting a list removes its tasks. The latest deletion can be undone while its resulting document is unchanged; later edits or another window's updates invalidate that undo snapshot.

The selected list supports text search and all/open/completed filters. Task reordering is disabled while filtering to avoid ambiguous positions. Copy Markdown exports all groups, lists and checklist items to the clipboard; Markdown is an export format, with no import or bidirectional synchronization.

Documents autosave independently of editor/session snapshots. Save failures retain local contents. Native committed-write events refresh clean cached copies in other windows. Focus and the explicit Refresh action reread external file changes. Dirty local buffers remain intact and conflicting writes require explicit reload or replacement. An outstanding read cannot overwrite a newer save. Malformed task JSON is displayed as an error without replacing the file with an empty task book.

Each workspace independently selects its storage:

- Application data (default): separate `tasks.json` and `notes.md` files under a directory keyed by the canonical project root.
- Project root: `.specops/tasks.json` and `.specops/notes.md`. The directory is created only on save; a symlink or non-directory at `.specops` is rejected. Hidden files are not automatically ignored by Git.
- App-wide documents are entries in the application's project catalog (`id`, `kind`, `name`, per-kind `order`) and keep their file in `global-documents/<id>/tasks.json` or `global-documents/<id>/notes.md` under the application data directory. Ids are limited to letters, digits and hyphens so a path cannot leave that directory. The previous single `global-documents/tasks.json` and `notes.md` files are not read or migrated.

Changing the workspace setting selects a source without copying or merging. A separate explicit transfer action moves existing current-format documents, confirms occupied destinations, and removes sources only after successful publication. No old Markdown task files or previous project paths are read, migrated or converted automatically. Closing a workspace, removing its catalog entry or closing a document tab does not delete its documents. Window close awaits all cached document saves, including app-wide documents. Session snapshots store view-tab identities rather than Tasks/Notes contents.

### Task JSON format

Array order determines display order. IDs must be nonempty and unique across groups, lists and tasks; task text and names must be nonblank. Every list references an existing group or `null`, and every task references an existing list. Frontend edits and native writes validate these invariants. Agents and external editors can edit this same file directly, preserving IDs when editing or moving items.

```json
{
  "version": 1,
  "groups": [{ "id": "release", "title": "Release" }],
  "lists": [{ "id": "checks", "title": "Checks", "groupId": "release" }],
  "tasks": [{ "id": "build", "listId": "checks", "text": "Verify the build", "completed": false }]
}
```

Deadlines, priorities, reminders, task dependencies, cloud synchronization and recurring tasks are outside this version.

## Workspace windows

Open in Separate Window moves the workspace to a new window. Move to Window… adds it to another existing window's group. Each window's rail shows its own workspace group; tab groups stay local to their window. Workspace order, selected tabs, panes, dirty buffers, document scroll positions, panel state and session references move together. Editor/context/pane/tab identifiers are reassigned to avoid collisions in the destination.

The destination subscribes to active native turn events before the source detaches. The transfer includes accumulated assistant output, event sequence checkpoints and outstanding permissions/questions; the native prompt is never resubmitted. Overlapping events are applied once. If the destination rejects its checkpoint, the source retains its workspace and resumes observing the same turn. A missing acknowledgment is resolved against durable ownership and destination transaction completion before releasing the source.

Editor input, menu commands and window close are suspended briefly while a move commits. A native operation still preparing, or compaction in progress, must finish before a move can start. Ordinary workspace switches keep background turns running.

Application quit preserves all window snapshots. Relaunch recreates their labels, groups, order and bounds, including incremental crash recovery records. Explicitly closing a secondary window removes that window from restoration. Committed workspace ownership filters stale source recovery records. Opening a workspace already in another live window activates that window.

## Project selection and moves

Cmd/Ctrl-click toggles selection; Shift-click selects a visible range; Cmd/Ctrl+A selects visible entries; Escape clears it. Modifier selection does not activate a file. Right-click preserves an existing selection when invoked on a selected row.

Group actions copy absolute or workspace-relative paths, move, delete, and change favorites. Copied paths have one entry per line in visible tree order. Disk mutations suppress descendants when an ancestor is selected.

Move To… chooses any OS destination folder. Conflicts offer Skip, Keep Both or Replace, with an option to apply the choice to remaining items. Directory merging is unsupported; folders cannot be replaced. Files open in another window cannot be replaced. Cross-volume moves copy to staging, verify contents and links, publish, then remove the source. Partial failures are reported. Open buffer paths and favorites update across windows.
