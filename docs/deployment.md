---
title: Deployment
type: deployment
created: 2026-10-24
updated: 2026-10-24
status: active
confidence: low
tags: [deployment, setup, telegram]
sources:
  - package.json
  - server.ts
  - settings.ts
  - adapters.ts
  - companion/aivech/package.json
  - companion/aivech/src/main.ts
  - companion/aivech/src/chat.ts
  - app.tsx
  - companion/aivech/src/bot.ts
  - companion/aivech/src/projects.ts
---

# Deployment

TL;DR: Install the BB plugin, configure a Telegram bot and pair its private owner; deploy the companion only when SMS delivery and its standalone commands are needed. (package.json), (server.ts:149-212), (companion/aivech/src/main.ts:11-32)

## Prerequisites

- BB version `>=0.43` and BB Plugin SDK `>=0.4.87`; the plugin build entry points are `server.ts` and `app.tsx`. (package.json)
- Telegram bot with threaded topics enabled. The connection diagnosis reports bot validity, bot identity, topic support, user-created-topic support and webhook presence. (settings.ts:25-76)
- The BB server needs outbound access to `api.telegram.org`; token lookup can use a manually stored secret or BB Env Catalog. (adapters.ts:23-40), (server.ts:178-187), (server.ts:319-333)
- Optional companion requires Node.js `>=24`, `grammy`, a local SMS inbox SQLite file and private configuration files. (companion/aivech/package.json), (companion/aivech/src/main.ts:11-30)

## Deploy procedure

1. Install Telegram Projects through BB and open its sidebar panel. The panel reads preferences and runtime status over RPC. (app.tsx:30-61)
2. Enter the Telegram bot token in **Connection**, or set the configured Env Catalog key. A manually saved token takes precedence; the environment value is refreshed at a five-minute interval. (server.ts:178-187), (server.ts:317-333)
3. Use **Check and save token** to inspect token validity, identity, topic support and webhook state. Diagnostics return flags and an error code, not the token. (settings.ts:25-76), (server.ts:103-110)
4. Pair the owner with the page's link/code. Code format and lifetime are documented in [Gotchas](gotchas.md). (server.ts:338-352)
5. Enable project synchronization and initialize topics explicitly. A new empty database reports `topics_not_initialized` until that action. (server.ts:158-162), (server.ts:510-518)
6. Enable chat bridging separately if Telegram messages should reach BB threads. Full and summary report modes and rich replies are plugin preferences. (server.ts:163-176), (server.ts:214-234)

## Optional companion

The companion uses configured private files beneath its installation-specific root, reads the SMS inbox SQLite database read-only, writes a protected SQLite outbox and publishes a status JSON file. It validates the configured owner and bot identity and exits when a webhook is configured, because it polls with `getUpdates`. (companion/aivech/src/main.ts:11-32), (companion/aivech/src/main.ts:60-81)

The plugin can publish project/task projection and write chat updates into the companion spool when the companion folder is configured. This deployment uses fixed personal filesystem paths and IDs in the companion source. (server.ts:188-192), (server.ts:1170-1215), (companion/aivech/src/chat.ts:13-24)

## Build and maintenance commands

From the repository root:

| Command | Purpose | Source |
|---|---|---|
| `npm run check` | TypeScript check. | (package.json) |
| `npm test` | Run root plugin tests. | (package.json) |
| `npm run build` | Build the BB plugin. | (package.json) |

The companion has `npm run build`, `npm start`, and `npm test` scripts, with tests building before execution. (companion/aivech/package.json)

## Verify

1. Run **Check and save token** and confirm the bot is valid, matches the stored bot, supports topics and has no webhook. These results are returned by the connection diagnosis. (settings.ts:25-33), (settings.ts:64-76)
2. Pair the private owner and check the plugin's **Overview** status for a linked owner. (server.ts:335-352), (server.ts:57-88)
3. Use **Create topics**, then confirm the project topics appear in the private bot chat. A new database remains uninitialized until this action. (server.ts:510-518)
4. If the optional companion is deployed, verify `/status` for its queue count and projection freshness. (companion/aivech/src/bot.ts:45), (companion/aivech/src/projects.ts:94-107)

## Rollback

Turn off **Project sync** and **Chat with BB from Telegram** in plugin settings to stop synchronization and chat intake. The toggles are separate settings; disabling the plugin does not delete the persisted `state` table. (server.ts:158-171), (server.ts:262-292)

For a companion token change, its file watcher sends `SIGTERM` when the configured token differs; the service closes its bot and databases during shutdown. (companion/aivech/src/main.ts:34-43), (companion/aivech/src/main.ts:157-160), (companion/aivech/src/main.ts:225-229)

## Troubleshooting

| Symptom | Cause and response |
|---|---|
| `owner_not_paired` | Pairing has not completed; request a fresh code from the plugin page and send `/start <code>` privately. (server.ts:453-455), (server.ts:338-352) |
| `topics_not_initialized` | Use the explicit **Create topics** action before sync can reconcile project topics. (server.ts:510-518) |
| `threaded_mode_disabled` | Enable threaded topics for the Telegram bot, then rerun connection check and sync. (server.ts:520-523), (settings.ts:64-76) |
| Companion exits before polling | Review any configured webhook before starting a `getUpdates` receiver. (companion/aivech/src/main.ts:74-81) |

## Related pages

- [Architecture](architecture.md)
- [Gotchas](gotchas.md)
- [Data model](data-model.md)

<!-- lane-pilot:backlinks -->
## Referenced by

- [Architecture](architecture.md)
- [Gotchas](gotchas.md)
- [Telegram interaction flow](interaction-0.3.1.md)
- [Telegram Projects overview](overview.md)
