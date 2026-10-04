export type FileChangeStatus = "added" | "deleted" | "modified" | "conflicted";
export interface FileStatusItem { path: string; status: FileChangeStatus; additions?: number; deletions?: number }
export interface SessionFileDiff { file: string; patch: string; additions: number; deletions: number; status: FileChangeStatus }
