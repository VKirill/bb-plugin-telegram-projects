---
title: Telegram Projects overview
type: overview
created: 2026-10-24
updated: 2026-10-24
status: active
confidence: medium
tags: [telegram, capabilities, overview]
sources:
  - server.ts
  - events.ts
  - model.ts
  - chat.ts
  - adapters.ts
  - app.tsx
  - locale.ts
  - companion/aivech/src/main.ts
  - package.json
---

# Telegram Projects overview

TL;DR: Telegram Projects links BB project topics to agent reports, Lane Pilot task notifications, and owner-controlled text or voice conversations with BB threads. (server.ts:149-208), (chat.ts:129-188)

## What it does

- Creates and reconciles Telegram topics for BB projects and optional navigation/SMS topics. Project visibility can use Project Folders data when configured. (model.ts:249-279), (server.ts:361-380)
- Delivers configured BB thread and task events; event settings include enabled state, sound and project selection. (events.ts:15-31), (app.tsx:648-715)
- Supports full agent reports or a generated summary mode, selected through plugin preferences. (server.ts:214-234), (model.ts:25-47)
- Connects a Telegram topic to a BB thread. The bridge accepts text, supported callbacks and voice metadata, then relays BB output to Telegram. (chat.ts:27-44), (chat.ts:129-160)
- Reads Lane Pilot tasks through `list_runs` and `get_run_card`, using each task's latest attempt for displayed status. (adapters.ts:127-175)
- Provides a bilingual plugin panel and bot text. English lookup falls back to the input text when a translation is absent. (app.tsx:42-56), (locale.ts:232-234)

## Stack

- BB plugin server and UI are TypeScript entry points; BB `>=0.43` and BB Plugin SDK `>=0.4.87`. (package.json)
- Runtime validation uses Zod; the plugin declares it as a runtime dependency. (package.json)
- The optional companion uses Node.js `>=24` and grammY. (companion/aivech/package.json)

## Boundaries

Telegram Projects is a BB plugin with an optional companion process for SMS and standalone bot commands. The companion is not required for plugin chat or event delivery. (server.ts:149-208), (companion/aivech/src/main.ts:11-32)

## Where to look next

- [Architecture](architecture.md) — runtime components and boundaries.
- [Usage](usage.md) — bot commands and conversations.
- [Deployment](deployment.md) — installation requirements and setup.
- [Data model](data-model.md) — persisted state and retention.

<!-- lane-pilot:backlinks -->
## Referenced by

- [Architecture](architecture.md)
