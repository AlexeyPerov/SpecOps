import { writable } from "svelte/store";

/**
 * True while an OS-level file drag hovers over this window. Driven by the
 * `onDragDropEvent` enter/over/leave/drop lifecycle in the app-shell runtime
 * so the drop overlay can advertise that releasing the drag opens the files.
 */
export const fileDragActive = writable(false);
