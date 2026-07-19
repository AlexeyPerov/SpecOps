/**
 * Lazy-picker resolver for code-splitting the picker overlays.
 *
 * Each picker (QuickOpen, CommandPalette, HeadingJump, BookmarkList,
 * SnippetInsert) is only mounted when the user invokes its shortcut, so its
 * component code should not be in the initial bundle. This helper returns a
 * cached promise for a picker's dynamically-imported module; callers render it
 * via Svelte's `{#await}` block:
 *
 * ```svelte
 * {#await loadLazyPicker("quick-open", () => import("./QuickOpenPicker.svelte")) then Cmp}
 *   <Cmp.default open={...} ... />
 * {/await}
 * ```
 *
 * The cache is keyed by a stable string so re-opening a picker resolves on the
 * next microtask instead of re-fetching the chunk.
 */
type PickerModule = { default: import("svelte").Component<any, any, any> };

const cache = new Map<string, Promise<PickerModule>>();

export function loadLazyPicker(
  key: string,
  load: () => Promise<PickerModule>,
): Promise<PickerModule> {
  let existing = cache.get(key);
  if (!existing) {
    existing = load();
    cache.set(key, existing);
  }
  return existing;
}
