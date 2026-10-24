---
title: Telegram integration research
type: overview
created: 2026-09-12
updated: 2026-10-24
status: active
confidence: low
tags: [research, telegram, integration]
sources:
  - server.ts
  - chat.ts
  - ingress.ts
  - adapters.ts
---

# Telegram integration research

TL;DR: The implementation uses Telegram as a transport and BB as the source of project, thread, task and interaction state. This page preserves research references; it does not claim a comparative product audit. (server.ts:149-208), (chat.ts:129-160)

## Design direction reflected in code

The plugin delegates thread operations to BB SDK and binds a Telegram topic to a BB thread, rather than storing a separate agent history. (chat.ts:142-160), (chat.ts:164-195)

Task information is read from Lane Pilot plugin RPC, with run attempts converted into a view model for Telegram notifications. (adapters.ts:138-175)

Telegram updates are filtered at ingress before they reach the bridge; chat callbacks are scoped to the `bb:` namespace. (ingress.ts:23-35)

## External references retained from the research pass

These links were used as documented references, not as independently tested products:

- [Hanoon](https://github.com/amrtawfik160/hanoon) — a BB-oriented Telegram agent reference.
- [Needs You](https://github.com/notpritam/bb-plugin-inbox) — BB Telegram notification plugin.
- [Takopi](https://github.com/banteg/takopi) — Telegram transport for coding agents.
- [cc-connect](https://github.com/chenhg5/cc-connect) — multi-agent messaging commands.
- [Hermes Telegram guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/messaging/telegram.md) — topic and session behavior.
- [OpenClaw Rich Messages](https://docs.openclaw.ai/channels/telegram/rich-messages) — Telegram rendering modes.
- [Claude Code Channels](https://code.claude.com/docs/en/channels-reference) — pairing and interaction relay.
- [Telegram Bot API](https://core.telegram.org/bots/api) — transport and message API.

The research record does not establish compatibility, runtime behavior, comparative reliability, cost, or security of those projects. The current implementation's modes and limits are described in [Interaction flow](interaction-0.3.1.md); runtime structure is in [Architecture](architecture.md).
