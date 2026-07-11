/**
 * Transaction annotations for editor content synchronization.
 * Store/external-origin updates must not report as user dirty edits.
 */
import { Annotation, type Transaction } from "@codemirror/state";

/** Marks a transaction that originated from app store / disk reload, not the user. */
export const storeOriginAnnotation = Annotation.define<"sync" | "reload">();

export function isStoreOriginTransaction(tr: Transaction): boolean {
  return tr.annotation(storeOriginAnnotation) !== undefined;
}

export function transactionHasStoreOrigin(
  transactions: readonly Transaction[],
): boolean {
  return transactions.some(isStoreOriginTransaction);
}
