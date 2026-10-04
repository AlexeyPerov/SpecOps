import type { NativeSessionRef } from './adapter';
export const NATIVE_VIEWS = ['checkpoints', 'sessions', 'todos', 'diffs', 'files', 'languageServices', 'commands', 'ecosystem', 'configuration'] as const;
export type NativeView = typeof NATIVE_VIEWS[number];
export const NATIVE_ACTIONS = ['fork', 'revert', 'restore', 'share', 'revokeShare', 'connectToolServer', 'disconnectToolServer'] as const;
export type NativeAction = typeof NATIVE_ACTIONS[number];
export interface NativeExtensionRequest { native: NativeSessionRef; workspaceRootPath: string }
export interface NativeExtensionRow { id: string; label: string; detail?: string; targetKind?: "checkpoint" | "toolServer" }
export interface NativeExtensionSnapshot { generation: number; scope: string; actions: readonly NativeAction[]; rows: readonly NativeExtensionRow[] }
export interface NativeExtensionResult { generation: number; native?: NativeSessionRef; url?: string; reconcile?: boolean }
export interface NativeExtensions {
  inspectNative(input: NativeExtensionRequest & { view: NativeView }): Promise<NativeExtensionSnapshot>;
  actNative(input: NativeExtensionRequest & { action: NativeAction; target?: string }): Promise<NativeExtensionResult>;
}
export function isNativeExtensions(value: unknown): value is NativeExtensions {
  return !!value && typeof (value as NativeExtensions).inspectNative === 'function' && typeof (value as NativeExtensions).actNative === 'function';
}
