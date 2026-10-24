---
title: Telegram Projects agent reference
updated: 2026-10-24
sources:
  - package.json
  - server.ts
  - ingress.ts
  - chat.ts
  - model.ts
  - docs/architecture.md
  - docs/data-model.md
  - docs/gotchas.md
---

# Telegram Projects agent reference

## Identity

- BB plugin `Telegram Projects`; package version and BB/SDK requirements: [package.json](package.json), [overview](docs/overview.md).
- Plugin entry: `server.ts`; UI entry: `app.tsx`. (server.ts:149-208), (package.json)
- Optional SMS companion lives under `companion/aivech/`; plugin behavior does not require it. [Architecture](docs/architecture.md)

## Entry points

- Plugin lifecycle and RPC: `plugin` and `rpcContract` in [server.ts](server.ts:89). (server.ts:89-208)
- Telegram update routing: `routeUpdate` in [ingress.ts](ingress.ts:14). (ingress.ts:14-70)
- Telegram chat runtime: `ChatBridge` in [chat.ts](chat.ts:129). (chat.ts:129-160)
- Data ingestion and project reconciliation: [model.ts](model.ts:140). (model.ts:140-189), (model.ts:249-279)
- Full command and route behavior: [Usage](docs/usage.md); flow across apps: [Interaction flow](docs/interaction-0.3.1.md).

## Critical invariants

- Only private messages whose sender ID equals the chat ID are eligible; paired owner filtering occurs before chat processing. (ingress.ts:23-35)
- A clean state store waits for explicit topic initialization; do not auto-reconcile an empty database into duplicate topics. (server.ts:510-518)
- A failed project read is not an authoritative deletion snapshot. (server.ts:477-480)
- An ambiguous topic creation must not be repeated automatically. (model.ts:212-236)
- A chat callback is bound to a topic revision and expiry; validate it against the current binding. (chat.ts:196-212)
- Data encoding, key families, lifecycles and cleanup: [Data model](docs/data-model.md).

## Conventions

- Keep each persisted value in the `state` store through its key prefix; use `Store.atomic` for multi-key updates. (server.ts:262-292)
- Plugin RPC input/output validation is declared in `rpcContract`. (server.ts:89-148)
- Keep Telegram transport behind `telegram()` and BB task reads behind `lanePilotReader()`. (adapters.ts:12-69), (adapters.ts:138-175)
- Translation maps English from Russian source strings and falls back to the source on a missing key. (locale.ts:232-234)

## Common gotchas

- `/tasks` is a plugin route. The companion also has `/tasks`, but it reads its own JSON projection. (ingress.ts:42-44), (companion/aivech/src/bot.ts:41-45)
- Plugin and companion must not poll updates concurrently with the same Telegram token. [Gotchas](docs/gotchas.md)
- Hidden project/folder handling can delete Telegram topics and bindings. (server.ts:527-548)
- Voice limits and output chunking: [Interaction flow](docs/interaction-0.3.1.md).

## Useful commands

- `npm run check` — typecheck.
- `npm test` — root tests.
- `npm run build` — BB plugin build.
- Companion: `npm run build`, `npm start`, `npm test` from `companion/aivech/`.

Scripts are declared in [package.json](package.json) and [companion package.json](companion/aivech/package.json).

## Where to look next

- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Deployment](docs/deployment.md)
- [Gotchas](docs/gotchas.md)
- [Usage](docs/usage.md)
