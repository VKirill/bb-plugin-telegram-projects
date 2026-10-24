---
title: Version 0.3 verification
type: gaps
created: 2026-09-13
updated: 2026-10-24
status: active
confidence: medium
tags: [verification, settings, telegram]
sources:
  - settings.ts
  - server.ts
  - ingress.ts
  - locale.ts
  - companion/aivech/src/main.ts
---

# Version 0.3 verification

TL;DR: The historical record covers plugin settings, token diagnosis, bilingual menu checks and receiver startup; a companion installation still uses fixed personal IDs and paths. (settings.ts:25-76), (companion/aivech/src/main.ts:11-32)

## Recorded checks

- The prior record reports typecheck/build success, plugin tests and companion tests.
- It reports that the installed plugin displayed its running state and retained project topic bindings.
- A live `checkConnection` call reported a valid token, the same bot, topic support, user-created-topic support and webhook absence; the token was not returned. The diagnosis contract contains flags and an error field, not a token field. (settings.ts:25-33), (settings.ts:64-76)
- An isolated browser harness rendered the actual settings UI and checked connection diagnostics, language selection and save/reload behavior. Authenticated rendering inside BB Connect was not verified.
- Telegram's command menu and companion project list were checked in English, then the Russian setting was restored. Translation lookup falls back to the Russian input for a missing English key. (locale.ts:232-234)

## Token and receiver limits

The historical check did not perform an actual token rotation. Plugin token settings support manual secret and Env Catalog sources; manual token wins when present. (server.ts:178-187), (server.ts:319-333)

The companion remains specific to one configured installation: it checks fixed owner/bot IDs and reads/writes paths beneath fixed roots. This does not describe the plugin's runtime pairing, which stores the owner after a valid pairing code. (companion/aivech/src/main.ts:11-32), (server.ts:335-352)

The companion polls Telegram and refuses startup if a webhook is configured; only one receiver can use `getUpdates` for a bot token. (companion/aivech/src/main.ts:74-81)

## Not covered

The record does not establish token rotation against a live bot, authenticated full-shell rendering, or a marketplace submission. BotFather's restricted-usage setting is not checked by `diagnose`, whose checks are limited to `getMe` and webhook information. (settings.ts:51-76)

<!-- lane-pilot:backlinks -->
## Referenced by

- [Roadmap and release state](roadmap.md)
