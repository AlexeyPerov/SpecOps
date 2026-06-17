<script lang="ts">
  import type { MessageAttachment } from "../ai/chatAttachments";

  interface Props {
    attachment: MessageAttachment;
  }

  let { attachment }: Props = $props();

  /**
   * Best-effort extension label from the filename (falls back to the mime
   * subtype). The OpenCode SDK `FilePart` and SpecOps `ChatFilePart` carry no
   * `size` field, so the chip renders filename + extension label rather than
   * a byte count.
   */
  let extensionLabel = $derived.by(() => {
    const filename = attachment.filename?.trim();
    if (filename) {
      const dot = filename.lastIndexOf(".");
      if (dot >= 0 && dot < filename.length - 1) {
        return filename.slice(dot + 1).toUpperCase();
      }
    }
    const slash = attachment.mime.lastIndexOf("/");
    if (slash >= 0 && slash < attachment.mime.length - 1) {
      return attachment.mime.slice(slash + 1).toUpperCase();
    }
    return attachment.mime.toUpperCase();
  });

  let displayName = $derived(attachment.filename ?? "file");
</script>

<a
  class="file-attachment-chip"
  href={attachment.url}
  download={attachment.filename ?? undefined}
  target="_blank"
  rel="noopener noreferrer"
  title={`Download ${displayName}`}
>
  <span class="file-attachment-icon" aria-hidden="true">⤓</span>
  <span class="file-attachment-name">{displayName}</span>
  <span class="file-attachment-ext">{extensionLabel}</span>
</a>

<style>
  .file-attachment-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-text-secondary) 5%, transparent);
    color: var(--color-text-primary);
    text-decoration: none;
    font-size: 11px;
    line-height: 1.4;
    cursor: pointer;
    transition:
      background-color var(--motion-fast) var(--easing-standard),
      border-color var(--motion-fast) var(--easing-standard);
  }

  .file-attachment-chip:hover {
    background: color-mix(in srgb, var(--color-text-secondary) 10%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 35%, var(--color-border-subtle));
  }

  .file-attachment-chip:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .file-attachment-icon {
    color: var(--color-text-secondary);
    font-size: 12px;
    flex-shrink: 0;
  }

  .file-attachment-chip:hover .file-attachment-icon {
    color: var(--color-accent);
  }

  .file-attachment-name {
    font-family: monospace;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-attachment-ext {
    flex-shrink: 0;
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
    color: var(--color-text-secondary);
    font-size: 9px;
    line-height: 1.4;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  @media (prefers-reduced-motion: reduce) {
    .file-attachment-chip {
      transition: none;
    }
  }
</style>
