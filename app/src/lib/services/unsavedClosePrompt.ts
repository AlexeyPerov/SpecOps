import { message } from "@tauri-apps/plugin-dialog";
import type { DocumentState } from "../domain/contracts";

export type UnsavedCloseAction = "save" | "discard" | "cancel";

export function needsCloseConfirmation(document: DocumentState): boolean {
  return document.isDirty;
}

export async function promptUnsavedClose(document: DocumentState): Promise<UnsavedCloseAction> {
  const result = await message(
    `Do you want to save changes to "${document.title}" before closing?`,
    {
      title: "Unsaved Changes",
      kind: "warning",
      buttons: { yes: "Save", no: "Don't Save", cancel: "Cancel" },
    },
  );

  if (result === "Save") {
    return "save";
  }
  if (result === "Don't Save") {
    return "discard";
  }
  return "cancel";
}
