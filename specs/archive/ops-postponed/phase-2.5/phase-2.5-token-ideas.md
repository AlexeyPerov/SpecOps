# Phase 2.5 — Token optimization ideas

**Status:** Ideas / not scheduled  
**Context:** Follow-up to M5 custom chat modes. Documents how chat requests consume tokens today, where efficiency is lost, and what to improve.

**Related code:**

- Prompt assembly: `app/src/lib/ai/modes/prompt.ts`, `app/src/lib/ai/modes/resolve.ts`, `app/src/lib/ai/modes/builtins.ts`
- Provider payload: `app/src/lib/ai/providers/types.ts`, `app/src/lib/ai/providers/openAiChatMessages.ts`
- Send pipeline: `app/src/lib/ai/chatSendPipeline.ts`
- Retention: `app/src/lib/services/chatRetention.ts`, `app/src/lib/services/chatPersistenceCodec.ts` (`CHAT_RETENTION_MAX_TURNS = 50`)

**See also:** [phase-2.5-ux-ideas.md](./phase-2.5-ux-ideas.md)

---

## How tokens are spent on each send

Every user message triggers one provider request. The request has two main token buckets:

1. **System prompt** — resolved mode persona, optional workspace/summary context, optional section-format instructions.
2. **Conversation history** — all retained user and assistant messages (system UI events like provider/model switches are excluded).

Both buckets are sent **on every turn**. There is no server-side session that remembers prior context; the model only sees what is in this request.

---

## What exists today

### Per-turn system prompt

**What it does:** On each send, `buildThreadProviderRequest()` resolves the active mode from current settings and `thread.metadata.mode`, then `resolveModeSystemText()` builds the system string (placeholder substitution + section instructions). `buildOpenAiChatMessages()` places it as the first message with `role: "system"`.

**Token effect:** The full system prompt is included in **every** API call. For short chats this is a small fixed overhead. For long threads the system prompt stays the same size while history grows — so system tokens become a smaller fraction of total cost over time, but they are still re-billed each turn with no caching.

**Optimization role:** Necessary for mode correctness (settings or mode can change between turns). Opportunity is to keep the system prompt **lean** and enable **provider prompt caching** for the stable prefix — not to send it only once without a stateful API.

---

### Full history per request

**What it does:** `buildProviderRequest()` maps all `thread.messages` with role `user` or `assistant` into `payload.history`. That array is appended after the system message in the OpenAI-compatible request body.

**Token effect:** Token cost scales **linearly with thread length** — each turn re-sends all previous turns. A 40-turn thread sends 40 user + up to 40 assistant messages on turn 41. This is the dominant cost for active long conversations.

**Optimization role:** Unavoidable for stateless Chat Completions unless the app moves to a stateful/thread API or aggressively trims history. Excluding system events avoids paying for short audit lines on every request.

---

### FIFO turn compaction (50-turn cap)

**What it does:** `CHAT_RETENTION_MAX_TURNS` is **50**. After each successful assistant response, `compactActiveThread()` runs. If turn count exceeds 50, `compactChatMessages()` removes the **oldest** complete turn(s) (user message plus following assistant replies until the next user). Protected messages (system events with `systemEvent`) are never dropped.

**Token effect:** Caps history growth at ~50 turns regardless of how long the agent lives. Without this, token cost would grow without bound. The cap is **turn-based**, not token-based — 50 turns of one-word replies cost far less than 50 turns of pasted specs, but both retain the same number of messages.

**Optimization role:** Primary **volume control** mechanism today. Prevents runaway history size but does not optimize for message length or model context limits.

---

### Compaction summary (metadata)

**What it does:** When turns are removed, `appendCompactionSummary()` appends bullet lines to `thread.metadata.summary`:

- Format: `- User: …` / `- Assistant: …`
- Each line truncated to **120 characters** (whitespace collapsed, ellipsis if cut).
- Multiple compaction events append to the same summary string.

**Token effect:** Summary lives in **metadata**, not in `messages`. It costs **zero tokens** until injected into the system prompt. When injected, it is typically much smaller than the removed messages (120 chars per removed message vs full original text).

**Optimization role:** **Lossy compression** of evicted history — trades fidelity for a small fixed-ish summary block. Quality is limited: no semantic merging, no deduplication of repeated points, no prioritization of important facts.

---

### Summary in system prompt (`{{summary}}`)

**What it does:** If the mode has `includeSummary: true` and the prompt template contains `{{summary}}`, `resolveModeSystemText()` substitutes:

```text
Earlier conversation summary:
{thread.metadata.summary}
```

If the toggle is off, or the placeholder is absent, or summary is empty, nothing is injected at that slot.

**Token effect:** Adds a compact substitute for removed turns into the **system** bucket instead of the **history** bucket. Custom modes with the placeholder (e.g. seeded presets) can keep long-term context after compaction at low token cost. Built-in Ask/Review/Raw prompts **do not** include `{{summary}}`, so compaction summary is stored but **not sent** for those modes today.

**Optimization role:** The intended bridge between compaction and model context. Underused for built-ins; effectiveness for custom modes depends on summary quality (currently mechanical bullets).

---

### Workspace line in system prompt (`{{workspace}}`)

**What it does:** If `includeWorkspace: true` and the prompt contains `{{workspace}}`, substitutes a **single line**:

- Workspace scope: `Workspace: {folderName} ({rootPath})`
- Chats scope: `Workspace: Chats (chat-http)`

No open files, file contents, tree, or selection are included.

**Token effect:** Very low — typically one line (~10–30 tokens). Toggles off or missing placeholder → zero workspace tokens.

**Optimization role:** Anchors the model to which workspace/agent context applies without the token cost of injecting documents. Intentionally avoids file-token blow-up; also means no RAG benefit.

---

### Section instructions (`requiredSections`)

**What it does:** For modes with non-empty `requiredSections`, `sectionInstructions()` appends a block listing exact `## Heading` names (plus Review effort guidance or custom `sectionGuidance`). This is concatenated to the prompt template after placeholder resolution.

**Token effect:** Adds ~50–200+ tokens per turn depending on section count and guidance length. Review mode **duplicates** sections: they appear in `REVIEW_MODE_SYSTEM_PROMPT` and again via `requiredSections` → wasted tokens and redundant instructions.

**Optimization role:** Drives structured output and UI section cards; not primarily a token feature. Duplication is a **regression** — fix by keeping sections in either the template or `sectionInstructions()`, not both.

---

## What is missing or weak

### Prompt / prefix caching

**Gap:** Stable system prefix (mode persona + sections) is resent verbatim every turn. No use of provider features that cache identical prompt prefixes (OpenAI prompt caching, Anthropic prompt caching, etc.).

**Token opportunity:** Cached prefixes are often billed at a reduced rate or skipped on cache hits. For threads with many turns, the system block is identical turn-over-turn — high cache hit potential.

**What to implement:** Structure the system prompt so the stable prefix (mode persona, section instructions) is a fixed leading block across turns. Enable provider-specific prompt caching flags or headers where the API supports them, and verify cache hits in provider usage logs.

---

### LLM-based summarization on compaction

**Gap:** Compaction summary is mechanical truncation, not semantic compression.

**Token opportunity:** A one-shot summarization call when evicting turns could replace thousands of history tokens with hundreds of summary tokens while preserving decisions, names, and constraints better than 120-char bullets. Cost: one extra call per compaction event; savings: every subsequent turn in the thread.

**What to implement:** On FIFO eviction in `compactChatMessages()`, call a summarization model with the removed turns and merge the result into `thread.metadata.summary` (replacing or appending to the 120-char bullet lines). Inject the updated summary via `{{summary}}` on subsequent sends.

---

### Context window budgeting

**Gap:** Retention uses turn count (50), not estimated tokens or model context limit. No pre-send check against `max_context` for the selected model.

**Token opportunity:** Before send, estimate tokens (system + history). If over budget, drop oldest **recent** messages or compact earlier than turn 50. Prevents failed requests and avoids paying for requests that exceed model limits. Handles uneven message sizes (one huge paste + 49 short turns).

**What to implement:** Estimate token count for system prompt + history before `buildProviderRequest()` sends. Compare against the selected model’s context limit; if over budget, compact or drop oldest turns proactively (before the 50-turn cap). Optionally expose a user setting for “last N turns + summary” as a lightweight send mode.

**Status:** **DONE (UI estimate slice)** — added realtime (debounced) context-window estimation in composer UI, displayed left of **Send** as `~used / limit` when limit is known and `~used tokens` otherwise.

**Implemented in addition to original task:**

- Added shared estimator utility (`app/src/lib/ai/contextWindowBudget.ts`) that reuses `buildThreadProviderRequest()` and estimates prompt cost for `systemPrompt + retained history + current draft`.
- Added model context-limit heuristics (`1m`, `200k`, `128k`, `64k`, `32k`, `16k`, `8k`) and defaults for GPT-4o family; unknown/debug models intentionally show no denominator.
- Wired composer to recompute estimate with delay (~220ms debounce) on draft/thread/model/mode/provider changes and surface warning colors near (`>=85%`) and over (`>=100%`) estimated limits.
- Kept this change non-destructive: no pre-send compaction/drop yet; estimator is now in place to power proactive trimming in a follow-up.

---

### Per-message truncation

**Gap:** Individual user or assistant messages are sent in full regardless of length.

**Token opportunity:** Cap per-message characters/tokens in provider history (with optional “full message stored locally, truncated in prompt” UX). Large pasted specs dominate a single turn’s cost and can crowd out useful older context within the 50-turn window.

**What to implement:** When mapping `thread.messages` to `payload.history`, truncate messages above a configurable character/token ceiling. Keep full text in local storage and show a UI hint when the provider payload is truncated.

---

### Duplicated Review section instructions

**Gap:** Review built-in prompt embeds section headings; `requiredSections` causes the same headings to be appended again.

**Token opportunity:** Immediate savings of ~100–150 tokens per Review request, plus clearer instructions (less model confusion). Low effort, pure win.

**What to implement:** Remove section headings from either `REVIEW_MODE_SYSTEM_PROMPT` or `requiredSections` in `resolve.ts` so `sectionInstructions()` is the single source of section formatting for Review mode.

---

### Non-functional built-in context toggles

**Gap:** Ask / Review / Raw prompts lack `{{workspace}}` and `{{summary}}`. Settings toggles for built-ins do not change the outgoing system prompt.

**Token opportunity (two-sided):**

- **Save tokens:** Users may think summary is on and expect larger prompts; actually built-ins send **no** summary — missing context, not extra cost.
- **Gain context efficiently:** Wiring toggles (auto-append or placeholders in built-ins) would let users opt in to small workspace/summary blocks without full history — the intended token tradeoff is currently unavailable for the most common modes.

**What to implement:** Add `{{workspace}}` and `{{summary}}` placeholders to built-in prompt templates, or auto-append workspace/summary blocks in `resolveModeSystemText()` when `includeWorkspace` / `includeSummary` toggles are on — matching custom mode behavior.

---

### Stateful / thread APIs

**Gap:** Stateless Chat Completions requires full history each call.

**Token opportunity:** Provider thread/session APIs (where supported) send only new messages after the first turn. Upfront migration cost; long-term savings scale with thread length. May not fit all HTTP-compatible endpoints.

**What to implement:** For providers that expose thread/session IDs, store the ID in thread metadata after the first send and send only new messages on later turns. Fall back to full history for providers without session support.

---

### Workspace file / document context

**Gap:** No injection of open tabs, selections, or file contents into chat context.

**Token opportunity:** Not a savings item today — it is **absence** of a major token consumer. Any future “include current file” feature needs explicit budgets (selection-only, max chars, relevance filtering) to avoid blowing the 50-turn cap’s effective context.

**What to implement:** When adding file/document context, inject only selection or capped excerpts (not whole files), enforce a per-request char/token budget, and prefer relevance filtering over dumping open tabs. Treat this as a new system-prompt or attachment bucket with explicit limits.

---

### Mode-aware history on mode switch

**Gap:** Switching mode mid-thread does not trim, re-summarize, or filter history for the new persona.

**Token opportunity:** Review → Ask may still send long critique-shaped history while Ask system prompt is short — paying for context that conflicts with the new mode. Optional “compact on mode switch” or mode-tagged history could reduce noise tokens (quality + cost).

**What to implement:** On mode change, optionally compact prior turns into a summary, filter history to messages tagged with the new mode, or offer a “compact on mode switch” setting that runs FIFO compaction + summarization before the next send.

---

## Practical optimization ideas (prioritized)

| # | Idea | Token impact | Effort | Status |
|---|------|--------------|--------|--------|
| 1 | Duplicated Review section instructions | Small per-turn savings; cleaner prompts | Low | **DONE** |
| 2 | Non-functional built-in context toggles | Enables cheap long-context via summary line vs full history | Low–medium | **DONE** |
| 3 | Context window budgeting | Prevents over-limit failures; trims fat threads | Medium | **DONE (UI estimate slice)** |
| 4 | LLM-based summarization on compaction | Better context per summary token | Medium | |
| 5 | Prompt / prefix caching | Recurring savings on long threads | Medium (provider-dependent) | |
| 6 | Per-message truncation | Caps worst-case single-turn blow-up | Medium | |
| 7 | Context window budgeting | User-controlled history token budget (last N turns + summary) | Medium | |
| 8 | Stateful / thread APIs | Large savings at scale | High | |

---

## Open questions

### 1. Should built-in modes auto-append workspace/summary when toggles are on, without requiring `{{placeholders}}`?

| Option | Description |
|--------|-------------|
| **A. Auto-append** | When toggles are on, append workspace/summary blocks after the template even if placeholders are absent. Built-ins need no template edits; custom modes can still use placeholders for layout. |
| **B. Placeholders only** *(recommended)* | Toggles inject content only where `{{workspace}}` / `{{summary}}` appear. One rule for built-in and custom modes; authors control ordering; no risk of duplicate blocks. |
| **C. Hybrid** | Built-ins auto-append when toggles are on and placeholders are absent; custom modes require explicit placeholders. |

**Status:** Resolved — built-in prompts now include `{{workspace}}` and `{{summary}}` (option **B**).

---

### 2. Is 50 turns the right cap, or should a token budget drive compaction (possibly with a lower turn cap as fallback)?

| Option | Description |
|--------|-------------|
| **A. Turn cap only (keep 50)** | Simple and predictable; status quo. Ignores uneven message sizes and model context limits. |
| **B. Token budget primary** | Estimate tokens before send; compact when over model limit or a configurable budget. Turn cap removed or raised. |
| **C. Hybrid — token budget + turn cap fallback** *(recommended)* | Pre-send token estimation triggers early compaction; `CHAT_RETENTION_MAX_TURNS` (50) remains a hard backstop for pathological threads. |

**Answer:** C

---

### 3. Should compaction summarization use the same model as chat (extra cost per compaction) or a cheaper fixed model?

| Option | Description |
|--------|-------------|
| **A. Same model as chat** | Best summary quality; highest cost per compaction event. |
| **B. Fixed cheaper model** | Dedicated small/fast model for summarization; lower compaction cost, may lose nuance on complex threads. |
| **C. User-configurable with cheaper default** *(recommended)* | Settings pick a summarization model; default to a cheap fixed model; allow override to the active chat model for quality. |

**Answer:** C

---

### 4. Which HTTP providers / models in Settings will support prompt caching first?

| Option | Description |
|--------|-------------|
| **A. OpenAI-compatible endpoints first** *(recommended)* | Implement for the existing OpenAI Chat Completions adapter (direct OpenAI, and proxies that honor the same caching semantics). Lowest integration cost; covers most configured connections today. |
| **B. Anthropic native first** | Explicit cache breakpoints; requires a separate adapter — not available in the current HTTP stack. |
| **C. Per-connection feature detection** | Probe or declare caching support per Settings connection; enable only where confirmed. Most flexible but more UI and plumbing. |

**Recommended rollout:** Start with **A** on connections using OpenAI models with documented prompt caching (e.g. GPT-4o family); add **C** later if mixed endpoints need different behavior.

**Answer:** A