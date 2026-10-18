<script lang="ts">
  import { untrack } from "svelte";
  import { getProjectCatalog, projectIdentity, subscribeProjectCatalog, updateCatalogProject } from "../../services/workspaceCatalog";
  import { PROJECT_COLORS, PROJECT_ICONS, projectColor, projectIcon } from "../workspaceRailPresentation";

  let { root }: { root: string | null } = $props();
  let catalog = $state.raw(getProjectCatalog());
  let busy = $state(false);
  let error = $state("");
  $effect(() => untrack(() => subscribeProjectCatalog((next) => { catalog = next; })));
  const project = $derived(root ? catalog.projects[projectIdentity(root)] : undefined);
  const color = $derived(projectColor(project?.color) ?? "");
  const icon = $derived(projectIcon(project?.icon) ?? "");
  async function save(field: "color" | "icon", value: string): Promise<void> {
    if (!root || busy) return;
    const workspace = root;
    busy = true;
    error = "";
    try { await updateCatalogProject(workspace, { [field]: value || null }); }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; }
  }
</script>
<section aria-label="Project appearance">
  <h3>Project appearance</h3>
  <p>Optional local color and symbol help distinguish projects in the sidebar. They are shared across your windows.</p>
  <label>Color
    <select value={color} disabled={!root || busy} onchange={(event) => { const value = event.currentTarget.value; event.currentTarget.value = color; void save("color", value); }}>
      <option value="">Default</option>
      {#each PROJECT_COLORS as item (item.value)}<option value={item.value}>{item.label}</option>{/each}
    </select>
  </label>
  <label>Symbol
    <select value={icon} disabled={!root || busy} onchange={(event) => { const value = event.currentTarget.value; event.currentTarget.value = icon; void save("icon", value); }}>
      <option value="">Project initial</option>
      {#each PROJECT_ICONS as item (item)}<option value={item}>{item}</option>{/each}
    </select>
  </label>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>
<style>
  section { margin-bottom: 24px; display: grid; gap: 8px; justify-items: start; }
  h3, p { margin: 0; }
  p { color: var(--color-text-secondary); font-size: .875rem; max-width: 65ch; }
  label { display: flex; gap: 12px; align-items: center; font-size: .875rem; }
  select { padding: 6px; background: var(--color-surface-1); color: var(--color-text-primary); border: 1px solid var(--color-border-subtle); }
  select:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 1px; }
  .error { color: var(--color-danger); overflow-wrap: anywhere; }
</style>
