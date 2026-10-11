<script lang="ts">
  import DialogShell from "./DialogShell.svelte";
  import { registerChoiceRunner, type ChoiceRequest, type ChoiceResult } from "../services/choiceDialog";
  let request = $state<ChoiceRequest | null>(null);
  let applyToAll = $state(false);
  let resolve: ((result: ChoiceResult | null) => void) | null = null;
  function finish(value: string | null): void {
    const done = resolve;
    resolve = null;
    request = null;
    done?.(value === null ? null : { value, applyToAll });
  }
  $effect(() => {
    registerChoiceRunner((next) => {
      finish(null);
      applyToAll = false;
      request = next;
      return new Promise((done) => { resolve = done; });
    });
    return () => { finish(null); registerChoiceRunner(null); };
  });
</script>
<DialogShell open={request !== null} title={request?.title ?? "Choose"} width={520} onDismiss={() => finish(null)}>
  {#if request}
    <p class="message">{request.message}</p>
    {#if request.allowApplyToAll}
      <label><input type="checkbox" bind:checked={applyToAll} /> Apply to remaining conflicts</label>
    {/if}
  {/if}
  {#snippet actions()}
    <button class="btn btn-secondary" type="button" onclick={() => finish(null)}>Cancel</button>
    {#each request?.options ?? [] as option (option.value)}
      <button class="btn btn-secondary" type="button" disabled={option.disabled} onclick={() => finish(option.value)}>{option.label}</button>
    {/each}
  {/snippet}
</DialogShell>
<style>
  .message { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
  label { display: flex; align-items: center; gap: 8px; }
</style>
