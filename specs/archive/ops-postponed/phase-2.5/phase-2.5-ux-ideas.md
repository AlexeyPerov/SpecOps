# Phase 2.5 — Chat mode UX ideas

**Status:** Ideas / not scheduled  
**Context:** Follow-up to M5 custom chat modes. UX gaps and improvements for composer, in-thread behavior, and settings — updated to reflect the **current** settings UI (2026-06-08).

**Related code:**

- Settings grid + editor: `app/src/lib/components/settings/ChatModesSettingsPanel.svelte`, `ChatModeEditorDialog.svelte`
- Composer: `app/src/lib/components/ChatModePicker.svelte`, `ChatComposer.svelte`
- Message list: `app/src/lib/components/ChatMessageList.svelte`, `app/src/lib/ai/chatReviewContent.ts`
- Mode switch: `app/src/lib/ai/composerSelectionActions.ts`

**See also:** [phase-2.5-token-ideas.md](./phase-2.5-token-ideas.md)

---

## Current settings UI (baseline)

Recent changes improved the Chat modes settings layout:

| Area | Current behavior |
|------|------------------|
| **Mode list** | Single **grid of square tiles** (built-ins + custom modes + `+` add tile). No nested foldouts or sidebar list. |
| **Selection** | Click any tile → **`ChatModeEditorDialog`** modal (backdrop, Escape to close, click-outside dismiss). |
| **Built-ins** | Ask, Review, Raw appear as tiles alongside custom modes. Raw tile visible always; **Enabled** checkbox only inside Raw’s editor. |
| **Custom modes** | `+` tile creates a draft and opens editor immediately. Disabled custom modes show a **Disabled** badge on the tile (dimmed tile). |
| **Built-in editor** | Read-only prompt textarea; workspace/summary toggles; required sections shown as read-only note (Review). |
| **Custom editor** | Name, prompt, toggles, required sections (add/reorder/remove), section guidance, **Delete mode** in footer. |
| **Placeholder hint** | One line under grid title: use `{{workspace}}` and `{{summary}}` in custom prompts. |

**What improved:** Faster scan of all modes; less nesting; add flow is one click; built-in vs custom share the same entry point (tile → dialog).

**What did not change (still relevant below):** Placeholder/toggle semantics, built-in toggles not affecting prompts, composer toolbar, in-thread mode switch behavior, section card rendering.

---

## Composer and discoverability

### Mode names only

`ChatModePicker` shows short labels (Ask, Review, custom names) with no description, icon, or tooltip. The settings grid shows the same names on tiles but does not explain behavior until the user opens a tile.

**Impact:** New users cannot tell what changes when switching modes (especially among four seeded presets + custom names).

**Ideas:**

- Short subtitle or tooltip on composer buttons (e.g. Review → “Structured critique”).
- Optional one-line description field on custom modes, shown in composer on hover/long-press.
- Link from composer “Mode” label to Settings → Chat modes (deep link optional).

---

### No mode-switch notice in thread

Provider and model switches insert auditable **system events** in message history. Mode switches only update `thread.metadata.mode` (CM-7: no `mode-switched` event).

**Impact:** Users can change Ask → Review mid-thread with no visible record; assistant behavior changes on the next send without explanation in the transcript.

**Ideas:**

- Optional `mode-switched` system line (parity with provider/model) — revisit CM-7 if confusion shows up in use.
- Subtle composer hint after switch: “Next reply will use **Review**.”

---

### Horizontal toolbar scaling

Composer still uses a **horizontal radio group** for modes. Settings grid scales to many tiles; composer does not have an overflow menu or grouping.

**Impact:** Many enabled custom modes + built-ins + Raw can crowd the composer on narrow widths (container query wraps toolbar but does not collapse modes).

**Ideas:**

- Overflow “More modes” dropdown when width is limited.
- Group built-ins vs custom in composer.
- Pin/favorite modes in settings (composer shows subset).

---

## Settings panel (remaining gaps)

### Resolved prompt preview

The editor shows raw prompt, toggles, and sections separately but not the **assembled** system string (`resolveModeSystemText` output).

**Impact:** Users cannot see whether toggles actually inject workspace/summary, or how section instructions append. Hard to debug “why doesn’t my mode include context?”

**Ideas:**

- Read-only “Preview resolved prompt” collapsible in `ChatModeEditorDialog` (custom + built-in).
- Live update as toggles/sections change.

---

### Built-in context toggles vs behavior

Dialog copy says “Toggle workspace and summary context per mode,” but built-in prompts have **no** `{{workspace}}` / `{{summary}}` placeholders — toggles do not alter the sent prompt today.

**Impact:** Misleading for Ask/Review/Raw; users may believe summary is included after compaction when it is not (for built-ins).

**Ideas:**

- Fix in product (auto-append or add placeholders) — see [token ideas](./phase-2.5-token-ideas.md).
- Until fixed: disable toggles for built-ins with explanation, or show warning in dialog when placeholders are absent.

---

### “Include workspace context” label

Toggle label implies files or rich workspace context; implementation is a **one-line path** via `{{workspace}}`.

**Impact:** Expectation mismatch in both grid hint and editor toggles.

**Ideas:**

- Rename to “Include workspace label” or “Include workspace path in prompt.”
- Short help text under toggle in dialog.

---

### Placeholder vs toggle documentation

Grid has a single sentence about placeholders. Editor does not explain that **both** placeholder in prompt **and** toggle must be set for injection (custom modes).

**Ideas:**

- Inline help in dialog: “Add `{{summary}}` to your prompt to inject compacted history when this toggle is on.”
- Disable or gray out toggles when placeholder missing, with link to insert snippet button.

---

### Built-in vs custom editor asymmetry

Same tile + dialog pattern, but built-in body is mostly read-only; custom gets full editing. Raw’s **Enabled** control is easy to miss (only inside Raw’s dialog, not on the tile).

**Impact:** Raw discoverability still low; users may not know Raw exists until they open every built-in tile.

**Ideas:**

- Visual badge on Raw tile when disabled (“Off”).
- Built-in tiles: small “Built-in” chip; custom tiles: “Custom” chip.
- Separate “Built-in” / “Custom” sections in grid (optional) without reverting to heavy foldouts.

---

### Delete vs disable

Custom modes: disable via checkbox in editor; delete via footer button. Tile shows **Disabled** badge but built-in Raw uses **Enabled** inverted semantics.

**Ideas:** Consistent “Enabled” toggle on all modes where applicable; confirm before delete.

---

## In-conversation UX

### Retroactive section rendering

`ChatMessageList` parses assistant messages with the **current** mode’s `requiredSections`, not the mode active when the message was sent.

**Impact:** Switching Review → Ask can collapse section cards on old messages to plain markdown (or change layout). Switching to a structured mode may try to parse old plain replies into sections incorrectly.

**Ideas:**

- Store `mode` (or `requiredSections`) on assistant messages at send time; render with that metadata.
- Or freeze section parsing for messages older than last mode switch.

---

### Compaction banner vs summary toggle

Thread shows a compaction notice when messages were FIFO-removed. Users may not connect this to `includeSummary` + `{{summary}}` in custom modes (or missing injection for built-ins).

**Ideas:**

- Banner copy: “Older messages summarized in prompt” when summary will be injected; “Older messages removed” when not.
- Link to edit active mode in settings.

---

### Mode switch without confirmation

Users can switch mode between messages while prior context was shaped for another persona (e.g. long Review critique thread, then Ask for a quick question).

**Ideas:**

- Soft warning on switch when thread has >N turns or last assistant message used structured sections.
- No blocking modal by default — optional setting.

---

## Product-level

### Chats scope workspace label

In chat-http, `{{workspace}}` resolves to `Workspace: Chats (chat-http)` — technical and opaque.

**Ideas:** Fixed label `Chats`; default `includeWorkspace` off for chat-http presets; document in editor when Chats context is active.

---

### Per-thread prompt override

M5 scoped mode templates to settings only; per-agent/thread system prompt override is out of scope (phase-7 tier 2C territory).

**Ideas:** “Override for this agent” in agent menu for power users — separate from mode templates.

---

## Suggested directions (not committed)

| Idea | Rationale | Settings UI note |
|------|-----------|------------------|
| Resolved prompt preview in dialog | Closes toggle/placeholder confusion | Fits naturally in `ChatModeEditorDialog` body |
| Mode descriptions on tiles or composer | Discoverability without opening editor | Optional subtitle under tile title |
| `mode-switched` system event | Transcript clarity | Independent of settings layout |
| Placeholder insert buttons | “Insert `{{summary}}`” in custom prompt field | Reduces doc-reading |
| Composer overflow menu | Scales mode count | Settings grid already scales; composer is the bottleneck |
| Per-message mode metadata | Fixes section card regression | Backend + message list, not settings |
| Raw “Off” badge on tile | Surfaces opt-in built-in | Small tile UI change |
| Simpler mental model | One prompt + “Structured output” toggle driving `requiredSections` | Could simplify dialog sections |

---

## Open questions

1. Should settings prioritize **preview/education** (resolved prompt, toggle hints) before composer changes?
2. Is tile grid sufficient for 10+ custom modes, or do we need search/filter in settings?
3. Revisit CM-7 (no mode-switch event) after users work with the new settings UI?
4. Should built-in tiles open the same dialog with preview-only tools, or a lighter “inspect” dialog distinct from custom edit?
