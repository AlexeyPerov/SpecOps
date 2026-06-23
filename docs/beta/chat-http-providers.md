# Chat providers — HTTP connection integration (beta)

> **Beta feature.** The HTTP chat context (`chat-http`) is an experimental
> beta lane (phase-3.5 M13). It is **disabled by default**. To enable it,
> open **Settings → Dev** and turn on **Chat (beta)**, then configure HTTP
> providers or Debug Provider under the **Chats** subtabs.

SpecOps routes **Chat context** (`chat-http`) AI through a small **provider registry**. Production traffic uses an **OpenAI-compatible HTTP connection** configured in **Settings → Dev → Providers** (after enabling Chat (beta)). **Debug** is a settings-gated local simulator for development.

**Workspace contexts** (`ws-*`) use the **OpenCode** backend exclusively — they do not route through the HTTP provider registry. See [opencode-integration.md](../opencode-integration.md) for integration details and setup, and [phase-3 spec](../../specs/ops/phase-3/phase-3.md) for original implementation context.

## Provider abstraction

```mermaid
sequenceDiagram
  participant UI as ChatPanel
  participant Send as sendChatMessage
  participant Reg as registry
  participant HTTP as OpenAiCompatibleChatProvider
  participant API as OpenAI-compatible API

  UI->>Send: sendChatMessage(text)
  Send->>Send: validateProviderSend
  Send->>Reg: getChatProvider("http")
  Send->>Send: buildThreadProviderRequest
  Send->>HTTP: streamProviderMessage -> streamMessage
  HTTP->>HTTP: buildOpenAiChatMessages
  HTTP->>API: POST .../chat/completions
  API-->>HTTP: SSE token deltas + [DONE]
  HTTP-->>Send: ProviderStreamChunk deltas
  Send-->>UI: update assistant message
```

### `ChatProvider` interface

Defined in `app/src/lib/ai/providers/types.ts`:

| Method | Purpose |
| --- | --- |
| `checkCapabilities` | Preflight: configured?, supported mode?, advertised capabilities |
| `sendMessage` | Non-streaming completion; returns full assistant text |
| `streamMessage` (optional) | Async iterable of text deltas |

Registry: `registerChatProvider` / `getChatProvider` in `registry.ts`. Bootstrap: `initializeChatProviders()` registers Debug and HTTP and wires `chatStore` capability checker + default provider resolver.

### Shared prompt payload

All providers receive the same **`ProviderRequestPayload`**:

- Mode (`ask` | `review`) and resolved **system prompt** (`modes/builtins.ts`)
- Workspace name and root path
- Optional **summary** from thread compaction (`chatRetention.ts`)
- **History** — user/assistant turns only (system UI events excluded)

Built by `buildThreadProviderRequest` → `buildProviderRequestFromThread` in `modes/prompt.ts`.

HTTP maps this to OpenAI-style messages in `openAiChatMessages.ts` (single combined `system` message + history).

## HTTP connection configuration

### Settings (`settings.json`)

Provider-specific blocks live under **`providerSettings`** (`AppProviderSettings` in `contracts.ts`), normalized in `appProviderSettings.ts`. Each provider type extends **`ProviderSettingsBase`** (`enabled: boolean`).

```json
{
  "providerSettings": {
    "http": { "enabled": true, "baseUrl": "https://api.openai.com/v1" },
    "debug": { "enabled": true, "simulationSeed": null, "delayMsMin": 200, ... }
  },
  "providerModelCatalogs": { "http": { "modelIds": ["gpt-4o-mini"], "defaultModelId": "gpt-4o-mini" } }
}
```

**Breaking change (phase 1):** legacy `providerSettings.glm` and top-level provider blocks are no longer used; re-save settings or edit `providerSettings.http` in `settings.json`.

#### HTTP (`providerSettings.http`)

Normalized in `httpConnectionSettings.ts`:

| Field | Default | Purpose |
| --- | --- | --- |
| `enabled` | `true` | Provider toggle |
| `baseUrl` | `https://api.openai.com/v1` | API root (trailing slashes stripped) |

#### Debug (`providerSettings.debug`)

Normalized in `debugProviderSettings.ts` (simulation timing, failure injection, diagnostics). Settings-gated; disabled by default in product builds.

Model lists and per-thread selection use **`providerModelCatalogs.http`** (`providerModelCatalog.ts`), editable in Settings. Default model: `gpt-4o-mini`.

Use `getProviderSettings(settings, "http")` from `appProviderSettings.ts` for typed access when adding providers — extend **`ProviderSettingsById`** once per new configured provider.

### Secrets (`provider-secrets.json`)

API keys per provider — `providerSecretsStore.ts`:

- Path: `{appDataDir}/spec-ops/provider-secrets.json`
- Format: `{ "version": 1, "keys": { "http": "..." } }` (`Partial<Record<ChatProviderId, string>>`)
- Loaded at startup in `appShellRuntime.ts` → `appState.setProviderApiKey("http", …)`
- **Never** written to `settings.json` or chat thread files
- Legacy `glm-secrets.json` is not used.

### “Configured” definition

`isHttpConnectionConfigured(settings, apiKey)` — `enabled` and non-empty trimmed API key. Unconfigured HTTP blocks send and shows inline setup CTA in `ChatPanel.svelte` (Settings → Dev → Providers, when Chat (beta) is enabled).

### Default provider selection

`resolveDefaultChatProvider` (`selection.ts`):

1. **HTTP** if configured (settings + key)
2. Else **debug** if debug provider enabled in Developer Settings
3. Else **http** as product fallback (still blocked until key is set)

Product-selectable providers in UI: **`http`** only; debug appears when enabled.

## HTTP adapter (`OpenAiCompatibleChatProvider`)

Implementation: `app/src/lib/ai/providers/openAiCompatibleChatProvider.ts`.

### Endpoint used

**OpenAI-compatible Chat Completions** on the configured base URL:

```
POST {baseUrl}/chat/completions
```

Resolver: `resolveOpenAiChatCompletionsUrl(baseUrl)` -> `{trimmedBase}/chat/completions`.

### Request

| Aspect | Value |
| --- | --- |
| Method | `POST` |
| Auth | `Authorization: Bearer {apiKey}` |
| Content-Type | `application/json` |

JSON body (only these fields are sent):

```json
{
  "model": "<resolved model id from thread/catalog>",
  "messages": [
    { "role": "system", "content": "<mode prompt + workspace + optional summary>" },
    { "role": "user|assistant", "content": "..." }
  ],
  "stream": false
}
```

`model` comes from `ProviderSendRequest.modelId` (thread `selectedModelId` or provider default).

### Response handling

Success (HTTP 2xx): parse JSON, read:

- `choices[0].message.content` — required non-empty trimmed string
- Top-level `error.message` — treated as failure even on 200

Errors: map status **401**, **403**, **429**, **5xx**, and model rejection messages via `mapHttpError` / `modelValidation.ts`. Bearer tokens in API messages are redacted in user copy.

### Capabilities

`checkCapabilities` when configured:

- `supportedModes`: `ask`, `review`
- `canReadWorkspaceFiles`: `true` (capability flag; actual file reads are not attached to prompts in MVP)

Unsupported modes return `WorkspaceAccessReason.ProviderUnsupported`.

## Streaming behavior

| Provider | `streamMessage` | UI behavior |
| --- | --- | --- |
| **Debug** | Implemented | Token-style partial updates in chat |
| **HTTP** | Implemented | OpenAI-compatible SSE parsing with incremental chat updates |

HTTP supports both paths:

- `streamMessage` sends `stream: true` and parses OpenAI-compatible SSE (`data: {...}` and `[DONE]`).
- `sendMessage` remains as buffered fallback (`stream: false`) for non-stream call sites/tests.

## OpenAI-compatible API: used vs unused

The app targets an OpenAI-compatible chat-completions surface. Only **one operation** is implemented.

### Used

| API | Path (relative to `baseUrl`) | Notes |
| --- | --- | --- |
| Chat Completions | `/chat/completions` | Non-streaming; `messages` + `model` only |

### Not used (no code paths)

These are common on OpenAI-compatible platforms but **absent from the codebase**:

| Category | Examples | Notes |
| --- | --- | --- |
| Streaming | `stream: true`, SSE chunks | Used by `streamMessage` |
| Other chat params | `temperature`, `top_p`, `max_tokens`, `stop`, `presence_penalty`, `frequency_penalty`, `tools`, `tool_choice`, `response_format` | Not sent |
| Multimodal / files | Image, file, or audio content in messages | Text-only `content` strings |
| Embeddings | `/embeddings` | — |
| Legacy/completion APIs | `/completions` (non-chat) | — |
| Model management | `GET /models`, dynamic model discovery | Catalog is settings-managed |
| Batch / async jobs | Batch inference endpoints | — |
| Tool / function calling | `tools`, function messages | — |
| Reasoning / thinking blocks | Vendor-specific extended fields | — |

`baseUrl` is user-configurable in Settings (for hosted APIs, gateways, or proxies). The app always appends `/chat/completions` — the base must be an API root that exposes that path.

## Other provider IDs

| Id | Status |
| --- | --- |
| `http` | Implemented (`openAiCompatibleChatProvider.ts`); **Chat context only** |
| `debug` | Implemented (`debugChatProvider.ts`); dev-only |

## Error and validation flow

1. **Local** — `validateLocalModelSelection` ensures `modelId` is in the provider catalog before HTTP.
2. **Preflight** — `chatStore.runAccessPreflight` + `createRegistryCapabilityChecker`.
3. **Runtime** — HTTP errors and model rejection strings → `ChatProviderError` with user-safe `userMessage`.

Send blocked reasons include `http_not_configured`, `invalid_model`, `preflight`, `provider_error` (`sendChatMessage.ts`).

## Key source files

| File | Responsibility |
| --- | --- |
| `openAiCompatibleChatProvider.ts` | HTTP adapter, error mapping |
| `openAiChatMessages.ts` | Payload -> `messages[]` |
| `appProviderSettings.ts` | Bundle normalize, `getProviderSettings` helpers |
| `httpConnectionSettings.ts` | HTTP defaults, normalize, configured checks |
| `debugProviderSettings.ts` | Debug simulator defaults and normalize |
| `providerSecretsStore.ts` | Provider API key persistence |
| `bootstrap.ts` | Register providers at startup |
| `capabilityChecker.ts` | Registry-backed preflight |
| `selection.ts` | Default provider, switch fallbacks |
| `providerModelCatalog.ts` | Model lists per provider |
| `sendChatMessage.ts` | End-to-end turn lifecycle |
| `chatSend.ts` | Stream vs buffered dispatch |
| `SettingsDialog.svelte` | Connections base URL, key, catalogs |
| `ChatPanel.svelte` | Composer, blocked states, model selector |

## Extending HTTP integration

When adding features, keep the adapter thin:

1. Extend **`ProviderRequestPayload`** or mode prompts if context changes — not provider-specific fields in the send path.
2. Add request fields in **`openAiCompatibleChatProvider.ts`** with tests in provider adapter tests.
3. For streaming, implement **`streamMessage`** with SSE parsing and keep `sendMessage` as fallback; update `streamProviderMessage` consumers and UX copy.
4. Never persist API keys outside **`providerSecretsStore`**.

See [architecture.md](./architecture.md) for overall layering and agent conventions. Product migration context lives in [ops roadmap](../specs/ops/roadmap.md).
