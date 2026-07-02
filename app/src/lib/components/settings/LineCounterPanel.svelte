<script lang="ts">
  import { countLinesInWorkspace, type LineCountResult } from "../../services/lineCounter";
  import { getLineCounterCache, setLineCounterCache } from "../../services/lineCounterCache";
  import { ensureWorkspaceReadAccess } from "../../services/fileSystem";

  let { workspaceRoot }: { workspaceRoot: string | null } = $props();

  let result = $state<LineCountResult | null>(null);
  let running = $state(false);
  let error = $state<string | null>(null);
  let scannedAt = $state<Date | null>(null);
  let progressLabel = $state<string | null>(null);
  let scanAbort = $state<AbortController | null>(null);

  const totalLines = $derived(result?.totalLines ?? 0);
  const codeFileCount = $derived(result?.codeFiles.length ?? 0);
  const ignoredFileCount = $derived(result?.ignoredFiles.length ?? 0);
  const skippedDirCount = $derived(result?.skippedDirs.length ?? 0);
  const readErrorCount = $derived(result?.readErrors.length ?? 0);
  const hasReadErrors = $derived(readErrorCount > 0);

  $effect(() => {
    const root = workspaceRoot;
    const controller = new AbortController();
    scanAbort = controller;

    if (root) {
      const cached = getLineCounterCache(root);
      if (cached) {
        result = cached.result;
        scannedAt = cached.scannedAt;
      } else {
        result = null;
        scannedAt = null;
      }
    } else {
      result = null;
      scannedAt = null;
    }

    error = null;
    progressLabel = null;

    return () => {
      controller.abort();
    };
  });

  async function runCount(): Promise<void> {
    if (!workspaceRoot || running) {
      return;
    }

    const accessStatus = await ensureWorkspaceReadAccess(workspaceRoot);
    if (accessStatus !== "ready") {
      error = "Cannot read this workspace folder. Check filesystem permissions or add the folder again.";
      return;
    }

    const signal = scanAbort?.signal;
    running = true;
    error = null;
    progressLabel = null;

    try {
      const nextResult = await countLinesInWorkspace(workspaceRoot, {
        signal,
        onProgress: (info) => {
          progressLabel = `Scanning ${info.relPath} (${info.filesScanned.toLocaleString()} files)`;
        },
      });

      if (signal?.aborted) {
        return;
      }

      const nextScannedAt = new Date();
      result = nextResult;
      scannedAt = nextScannedAt;
      setLineCounterCache(workspaceRoot, { result: nextResult, scannedAt: nextScannedAt });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      error = err instanceof Error ? err.message : String(err);
      result = null;
      scannedAt = null;
    } finally {
      running = false;
      progressLabel = null;
    }
  }
</script>

<section class="settings-section">
  <h3>Line counter</h3>
  <p class="settings-section-note">
    Counts newline lines in source files (C/C++, Go, Rust, Python, JS/TS, Java, Kotlin, Swift, C#,
    HTML/CSS, Svelte, Vue and more). Markdown, JSON, YAML and TOML are excluded as data/docs.
    Dependency and build folders (node_modules, target, dist, build, vendor, __pycache__) and
    dot-directories are skipped.
  </p>

  <div class="line-counter-stat">
    <span class="line-counter-total">{result ? totalLines.toLocaleString() : "—"}</span>
    <span class="line-counter-total-label">
      {result ? "total lines of code" : "not scanned yet"}
    </span>
  </div>

  {#if result}
    <dl class="line-counter-breakdown">
      <div>
        <dt>Code files</dt>
        <dd>{codeFileCount.toLocaleString()}</dd>
      </div>
      <div>
        <dt>Ignored files</dt>
        <dd>{ignoredFileCount.toLocaleString()}</dd>
      </div>
      <div>
        <dt>Skipped directories</dt>
        <dd>{skippedDirCount.toLocaleString()}</dd>
      </div>
    </dl>
  {/if}

  {#if hasReadErrors}
    <details class="line-counter-read-errors">
      <summary>
        {readErrorCount.toLocaleString()} read {readErrorCount === 1 ? "error" : "errors"}
        {#if result && result.totalLines === 0}
          (scan may be incomplete)
        {/if}
      </summary>
      <ul>
        {#each result?.readErrors ?? [] as readError (readError)}
          <li>{readError}</li>
        {/each}
      </ul>
    </details>
  {/if}

  {#if scannedAt}
    <p class="line-counter-scanned">Scanned {scannedAt.toLocaleString()}</p>
  {/if}

  {#if error}
    <p class="line-counter-error">{error}</p>
  {/if}

  <button
    class="line-counter-run"
    type="button"
    disabled={!workspaceRoot || running}
    onclick={() => void runCount()}
  >
    {running ? (progressLabel ?? "Counting…") : "Run line count"}
  </button>
</section>

<style>
  .line-counter-stat {
    display: flex;
    align-items: baseline;
    gap: var(--space-4);
  }

  .line-counter-total {
    font-size: 1.6rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .line-counter-total-label {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .line-counter-breakdown {
    display: flex;
    gap: var(--space-12);
    margin: 0;
  }

  .line-counter-breakdown div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .line-counter-breakdown dt {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }

  .line-counter-breakdown dd {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .line-counter-read-errors {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .line-counter-read-errors summary {
    cursor: pointer;
    color: var(--color-danger, var(--color-text-secondary));
  }

  .line-counter-read-errors ul {
    margin: var(--space-2) 0 0;
    padding-left: var(--space-8);
    max-height: 12rem;
    overflow-y: auto;
  }

  .line-counter-read-errors li {
    font-family: var(--font-mono, monospace);
    font-size: 0.75rem;
    word-break: break-all;
  }

  .line-counter-scanned {
    margin: 0;
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .line-counter-error {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-danger, var(--color-text-secondary));
  }

  .line-counter-run {
    align-self: flex-start;
    padding: var(--space-2) var(--space-6);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .line-counter-run:hover:not(:disabled) {
    background: var(--color-surface-3, var(--color-surface-2));
  }

  .line-counter-run:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
