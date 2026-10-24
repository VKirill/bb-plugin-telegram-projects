---
title: Roadmap and release state
type: overview
created: 2026-09-12
updated: 2026-10-24
status: active
confidence: medium
tags: [roadmap, releases, status]
sources:
  - server.ts
  - chat.ts
  - adapters.ts
  - app.tsx
  - ingress.ts
  - model.ts
  - commands.ts
  - companion/aivech/src/main.ts
  - companion/aivech/src/bot.ts
---

# Roadmap and release state

TL;DR: The repository implements project topics, Lane Pilot and BB thread events, owner pairing, plugin-side Telegram polling, chat bridging, voice transcription, summary reporting, and an optional companion. (server.ts:149-208), (ingress.ts:14-70), (chat.ts:129-160)

## Implemented capabilities

- Project topics are explicitly initialized and reconciled from BB project snapshots. (server.ts:477-480), (server.ts:510-548), (model.ts:249-279)
- Lane Pilot tasks are read through plugin RPC and converted into event snapshots; status mapping is documented in [Interaction flow](interaction-0.3.1.md). (adapters.ts:127-175), (model.ts:140-183)
- BB thread reports can be delivered in full or summary mode; summary workers use hidden BB threads and a three-minute timeout before fallback. (server.ts:735-774), (server.ts:869-872)
- Telegram owner pairing and plugin-side update intake are implemented, with chat and callback routing into the BB bridge. (server.ts:335-352), (ingress.ts:14-70), (chat.ts:129-160)
- Voice/audio input uses BB transcription and rejects files exceeding its size or duration limits. (adapters.ts:176-226)
- Settings expose event filters, project filters and sound controls. (app.tsx:648-715)
- The optional companion provides SMS delivery plus `/projects`, `/tasks`, and `/status`. (companion/aivech/src/main.ts:20-32), (companion/aivech/src/bot.ts:41-45)

## Remaining work

The source contains no release acceptance criteria or committed delivery dates for later work. Items that remain product proposals in the prior plan include richer attachment handling, task creation/control from Telegram, and a reusable companion deployment. These are not described as implemented capabilities. Current command routing and supported inputs are documented in [Usage](usage.md) and [Interaction flow](interaction-0.3.1.md). (ingress.ts:45-69), (commands.ts:12-71)

## Verification records

- [v0.2 verification](verification-0.2.md) records a live text/voice interaction and its limits.
- [v0.3 verification](verification-0.3.md) records settings, diagnostics and installed receiver checks.
- [Native CLI profiles](profiles-0.4.md) records profile selection behavior and its validation scope.
