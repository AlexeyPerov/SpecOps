<script lang="ts">
  /**
   * Renders a markdown source string as sanitized, syntax-highlighted HTML.
   *
   * Used for assistant text parts. Wraps the memoized `renderChatMarkdown`
   * helper so a re-render of a long message costs effectively nothing.
   * Streaming messages render plain text until generation completes — that
   * decision belongs to the parent, which can simply omit this component
   * while streaming.
   *
   * highlight.js loads on demand when a fenced code block is first seen.
   * Until then code blocks show escaped plain text; we re-derive when
   * `chatHighlightReady` flips so tokens appear without remounting.
   */
  import { chatHighlightReady, renderChatMarkdown } from "../ai/chatMarkdown";

  interface Props {
    source: string;
  }

  let { source }: Props = $props();

  const highlightReady = $derived($chatHighlightReady);
  let result = $derived.by(() => {
    void highlightReady;
    return renderChatMarkdown(source);
  });
</script>

<div class="chat-prose">{@html result.html}</div>
