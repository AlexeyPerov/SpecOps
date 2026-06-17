<script lang="ts">
  /**
   * Renders a markdown source string as sanitized, syntax-highlighted HTML.
   *
   * Used for assistant text parts. Wraps the memoized `renderChatMarkdown`
   * helper so a re-render of a long message costs effectively nothing.
   * Streaming messages render plain text until generation completes — that
   * decision belongs to the parent, which can simply omit this component
   * while streaming.
   */
  import { renderChatMarkdown } from "../ai/chatMarkdown";

  interface Props {
    source: string;
  }

  let { source }: Props = $props();

  let result = $derived(renderChatMarkdown(source));
</script>

<div class="chat-prose">{@html result.html}</div>
