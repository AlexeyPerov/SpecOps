<script lang="ts">
  import { pendingPermissionPrompts } from "../services/permissionPrompt";
  import { pendingQuestionPrompts } from "../services/questionPrompt";
  import PermissionRequestCard from "./PermissionRequestCard.svelte";
  import QuestionRequestCard from "./QuestionRequestCard.svelte";

  interface Props {
    /** Workspace root (chat scope key) of the session shown in the chat. */
    root: string | null;
    sessionId: string | null;
  }

  let { root, sessionId }: Props = $props();

  // Requests stay queued per session; they appear whenever that session's
  // chat is shown and disappear once answered, superseded, or aborted.
  const pendingPermission = $derived(pendingPermissionPrompts.forSession(root, sessionId));
  const pendingQuestion = $derived(pendingQuestionPrompts.forSession(root, sessionId));
</script>

{#if $pendingPermission}
  {#key $pendingPermission.seq}
    <PermissionRequestCard entry={$pendingPermission} />
  {/key}
{/if}
{#if $pendingQuestion}
  {#key $pendingQuestion.seq}
    <QuestionRequestCard entry={$pendingQuestion} />
  {/key}
{/if}
