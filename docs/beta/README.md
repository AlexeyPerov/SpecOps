# Beta / experimental features

Features under this folder are **experimental**. They are intentionally kept
out of the main docs and out of the default settings sidebar — opt-in is
required, and behavior / location may change between releases.

## Active beta features

| Feature | Doc | How to enable |
| --- | --- | --- |
| **Chat (beta)** — HTTP chat context (`chat-http`) with OpenAI-compatible providers and Debug Provider | [chat-http-providers.md](./chat-http-providers.md) | **Settings → Dev → Enable Chat (beta)** |

## Why these are beta

The product's stable AI story is **workspace agents** powered by
[OpenCode](../opencode-integration.md). The HTTP chat context (`chat-http`)
predates that move and is preserved as a beta lane for users who already
configured an HTTP connection. It is not part of the recommended setup for
new users; see the [main README](../../README.md) for the current AI story.

## Reporting issues

Beta features accept feedback through normal channels. Please note the
version and which beta feature is in use.