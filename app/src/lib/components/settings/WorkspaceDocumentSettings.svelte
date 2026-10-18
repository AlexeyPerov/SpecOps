<script lang="ts">
  import { untrack } from "svelte";
  import { getWorkspaceDocumentStorage, setWorkspaceDocumentStorage, subscribeWorkspacePreferences, type WorkspaceDocumentStorage } from "../../services/workspacePreferences";
  import { flushWorkspaceDocuments, loadWorkspaceDocument, transferWorkspaceDocuments } from "../../services/workspaceDocuments";
  import { requestConfirm } from "../../services/confirmDialogUi";
  let { root }: { root: string | null } = $props();
  let storage = $state<WorkspaceDocumentStorage>("app");
  let busy = $state(false);
  let error = $state("");
  let revision = $state(0);
  $effect(() => untrack(() => subscribeWorkspacePreferences(() => { revision++; })));
  $effect(() => { const workspace = root; void revision; storage = workspace ? getWorkspaceDocumentStorage(workspace) : "app"; });
  async function select(next: WorkspaceDocumentStorage): Promise<void> {
    if (!root || busy) return;
    busy = true; error = "";
    try { await flushWorkspaceDocuments(root); await setWorkspaceDocumentStorage(root, next); storage = next; }
    catch (cause) { error = String(cause); }
    finally { busy = false; }
  }
  async function transfer(): Promise<void> {
    if (!root || busy) return;
    busy = true; error = "";
    const workspace = root; const target = storage === "app" ? "project" : "app";
    try {
      await flushWorkspaceDocuments(workspace);
      const sourceFiles = await Promise.all((["tasks", "notes"] as const).map((kind) => loadWorkspaceDocument(workspace, kind, storage, true)));
      if (sourceFiles.every((file) => file.content === null)) { error = "There are no documents to move in the selected location."; return; }
      const destinationFiles = await Promise.all((["tasks", "notes"] as const).map((kind) => loadWorkspaceDocument(workspace, kind, target, true)));
      const replace = destinationFiles.some((file, index) => file.content !== null && sourceFiles[index].content !== null);
      if (!(await requestConfirm({ title: "Move workspace documents", message: `Move existing Tasks and Notes to ${target === "project" ? "the .specops folder in the project" : "SpecOps storage"}?${replace ? " Existing destination documents will be replaced." : ""}`, confirmLabel: "Move documents", danger: replace }))) return;
      error = (await transferWorkspaceDocuments(workspace, target, replace)) ?? "";
      storage = target;
    } catch (cause) { error = String(cause); }
    finally { busy = false; }
  }
</script>
<section>
  <h3>Tasks and Notes</h3>
  <p>Select where this workspace reads and saves its documents. Changing this option leaves existing files in place.</p>
  <label>Storage
    <select value={storage} disabled={!root || busy} onchange={(event) => { const next = event.currentTarget.value as WorkspaceDocumentStorage; event.currentTarget.value = storage; void select(next); }}>
      <option value="app">SpecOps data (default)</option>
      <option value="project">.specops folder in project root</option>
    </select>
  </label>
  <p>{storage === "project" ? ".specops/tasks.json and .specops/notes.md" : "Separate tasks.json and notes.md files in SpecOps workspace storage."}</p>
  <button type="button" class="btn btn-secondary" disabled={!root || busy} onclick={() => { void transfer(); }}>Move existing documents to {storage === "app" ? "project" : "SpecOps"}…</button>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>
<style>
  section { margin-bottom: 24px; }
  p { color: var(--color-text-secondary); font-size: .875rem; max-width: 65ch; }
  label { display: flex; gap: 12px; align-items: center; }
  select { padding: 6px; background: var(--color-surface-1); color: var(--color-text-primary); border: 1px solid var(--color-border-subtle); }
  .error { color: var(--color-danger); overflow-wrap: anywhere; }
</style>
