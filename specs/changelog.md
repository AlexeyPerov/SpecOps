# Changelog

## 2026-06-06

- **Settings sidebar categories.** Settings dialog sidebar now groups options into top-level **Editor** and **Shortcuts** tabs, with **Chats** and **Workspaces** section labels above **Connections** and **Debug AI** respectively. Section labels use smaller indent, bold 13px type; all selectable tabs share a larger uniform indent so headings are visually distinct from options.
- **Workspace rail reorder.** Workspace icons in the activity rail can be reordered by drag-and-drop (when two or more workspaces are open) or via right-click **Move Up** / **Move Down**. Order is persisted per window in the session snapshot. Active context is unchanged on reorder; new workspaces still append at the end. Added hidden `workspace.reorder` command for automation (`fromIndex` / `toIndex` payload).
