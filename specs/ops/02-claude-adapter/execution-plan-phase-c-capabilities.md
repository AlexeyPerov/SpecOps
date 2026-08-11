# 02 — Phase C: permissions, questions and optional capabilities

**Date:** 2026-08-11  
**Status:** Planned  
**Prerequisite:** Phase B Done  
**Scope:** [`README.md`](README.md)  
**Index:** [`execution-plan.md`](execution-plan.md)  
**Goal:** Expose supported interactive and configuration depth without widening the core.

## Agent handoff boundary

Own adapter extensions and their runtime-specific settings UI. Do not emulate
unsupported features or add required methods to the common core without cross-adapter evidence.

## Tasks

### AS02-C-01 — Permission and question replies

Map SDK callbacks into common request/reply events, including allow/deny,
answers, cancellation, timeout, and late-reply rejection.

**Acceptance:** Prompts survive UI rerender/restart rules and each request resolves exactly once.

### AS02-C-02 — Tool and autonomy controls

Expose supported model/mode, allowed/disallowed tools, turn limit, budget, and
write-capability metadata with validation at the host boundary.

**Acceptance:** Unsupported controls are absent; invalid combinations fail before a turn starts.

### AS02-C-03 — MCP, skills, hooks and subagents

Map only SDK-supported discovery/configuration and events through optional
extensions; keep native detail in the adapter-specific panel.

**Acceptance:** Common UI remains functional when every optional extension is absent.

### AS02-C-04 — Capability UI and fixture coverage

Wire descriptors to creation/settings/action UI and add fixtures for each
supported/unsupported combination.

**Acceptance:** Disabled/hidden states explain runtime limitations and never offer a no-op action.

## Verification

- Run extension schema, permission/question and capability UI tests.
- Exercise at least one allowed, denied, answered, cancelled, and timed-out interaction.
- Compare descriptors against the pinned SDK’s actual supported options.

## Handoff

Phase D begins when the declared capability manifest exactly matches tested behavior.
