import { writable } from "svelte/store";

/**
 * Minimal transient-message bus (toast stack). The status bar already carries
 * the informational side of every operation; toasts exist for outcomes a user
 * must not miss — e.g. a dropped file that failed to open, which previously
 * surfaced only as easy-to-miss status text and looked like a silent no-op.
 */

export type ToastKind = "info" | "error";

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  message: string;
}

const DEFAULT_TOAST_TTL_MS = 6000;
const MAX_VISIBLE_TOASTS = 4;

const { subscribe, update } = writable<ToastMessage[]>([]);

let nextToastId = 1;

export function showToast(
  message: string,
  kind: ToastKind = "info",
  ttlMs = DEFAULT_TOAST_TTL_MS,
): void {
  const id = nextToastId++;
  update((toasts) => {
    // Keep the stack bounded: oldest entries drop off the top.
    const next = [...toasts, { id, kind, message }];
    return next.length > MAX_VISIBLE_TOASTS ? next.slice(next.length - MAX_VISIBLE_TOASTS) : next;
  });
  setTimeout(() => dismissToast(id), ttlMs);
}

export function showErrorToast(message: string): void {
  showToast(message, "error");
}

export function dismissToast(id: number): void {
  update((toasts) => toasts.filter((toast) => toast.id !== id));
}

export const toasts = { subscribe };
