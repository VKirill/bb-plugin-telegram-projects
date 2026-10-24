---
title: Telegram interaction flow
type: flow
created: 2026-09-12
updated: 2026-10-24
status: active
confidence: low
tags: [telegram, flow, chat, notifications]
sources:
  - ingress.ts
  - server.ts
  - chat.ts
  - adapters.ts
  - model.ts
  - events.ts
  - companion/aivech/src/main.ts
  - companion/aivech/src/bot.ts
  - companion/aivech/src/projects.ts
  - companion/aivech/src/chat.ts
  - companion/aivech/src/locale.ts
  - locale.ts
  - app.tsx
---

# Telegram interaction flow

TL;DR: The plugin pairs one private Telegram owner, syncs project topics and event state, then routes eligible Telegram updates into BB chat bindings and returns BB output through Telegram. (server.ts:335-352), (ingress.ts:14-70)

## Trigger

An owner sends a Telegram message, supported callback, voice/audio message, or creates a topic. Separately, BB project/task/thread state changes can wake synchronization and event delivery. The companion handles SMS updates and its own `/projects`, `/tasks`, and `/status` commands. (ingress.ts:36-70), (server.ts:491-507), (companion/aivech/src/bot.ts:33-45)

## How it works

1. **BB plugin / `plugin`** defines settings and `rpcContract`, creates the SQLite-backed `Store`, and starts its lifecycle workers. The UI loads `preferences` and `status` RPC and saves event rules through `eventsGet`/`eventsSave`. (server.ts:89-148), (server.ts:149-208), (server.ts:262-292), (app.tsx:44-54), (app.tsx:657-666)
2. **BB plugin / owner pairing** issues a time-limited code. `routeUpdate` accepts pairing only for `/start <code>` in a private chat before an owner exists; after pairing it rejects foreign senders from the chat path. (server.ts:338-352), (ingress.ts:23-35)
3. **BB plugin / sync loop** reads standard BB projects, optional Project Folders data and Lane Pilot tasks. Tasks are read with `list_runs`; run cards supply titles, and the newest attempt for each task determines its displayed state. (server.ts:477-507), (adapters.ts:138-175)
4. **BB plugin / topic reconciliation** creates or renames topics, maintains navigation and optional SMS topics, and delays removed-project cleanup. A fresh empty store waits for explicit topic initialization. (model.ts:206-247), (model.ts:249-279), (server.ts:510-548)
5. **BB plugin / event ingestion** compares task snapshots, enqueues newly observed task transitions after the silent baseline, and collects thread events for visible projects. (model.ts:69-85), (model.ts:140-183), (server.ts:548-550)
6. **Telegram Bot API / update receiver** polls updates and calls `routeUpdate`. The router ignores non-private chats, foreign identities and callback payloads outside the `bb:` namespace; `/tasks` becomes a plugin task request. (server.ts:608-650), (ingress.ts:19-47)
7. **BB plugin / `ChatBridge`** validates chat input, resolves or creates a per-topic binding, stores callback actions with a revision and expiry, and maps user input to the bound BB thread. (chat.ts:27-64), (chat.ts:129-160), (chat.ts:164-212)
8. **BB SDK / thread operations** send input, answer supported pending interactions, request stop or spawn a thread according to the selected action. Voice input calls the configured transcription adapter before it is sent as text. (chat.ts:142-159), (adapters.ts:176-226)
9. **BB plugin / outbound delivery** formats thread and task results, then sends or edits Telegram messages. Telegram errors carry retry delay; message chunks are split below Telegram's message limit and avoid splitting a surrogate pair. (chat.ts:108-118), (adapters.ts:50-65), (server.ts:760-920)
10. **Optional companion / SMS and command routes** reads its SMS inbox, persists delivery receipts, and handles `/projects`, `/tasks`, `/status`. Its project reader selects the current project's tasks from the companion projection. (companion/aivech/src/main.ts:20-32), (companion/aivech/src/bot.ts:41-45), (companion/aivech/src/projects.ts:41-92)
11. **Locale modules / translation** map known Russian source strings to English when the configured language is `en`; missing translations return the original string. (locale.ts:232-234), (companion/aivech/src/locale.ts:222-224)

### BB plugin lifecycle (`plugin`)

1. `plugin(bb)` defines preference defaults, including project sync and chat disabled, Russian language, Rich Replies enabled, and optional companion/SMS settings. It creates the plugin SQLite `state` table and a `Store` wrapper that JSON-encodes values and supports transactions. (server.ts:149-212), (server.ts:262-292)
2. It creates the Lane Pilot reader through BB plugin RPC, and selects a bot token from the manual secret first or Env Catalog otherwise. The Env Catalog value is cached for five minutes. (server.ts:306-333)
3. It registers the typed RPC contract for preferences, token diagnosis, event rules, topic initialization, pairing, status and sync. Invalid request shapes are rejected by the contract schemas. (server.ts:89-148), (server.ts:926-988)
4. The project/task sync service subscribes to project and thread changes, then syncs and sleeps until a wake event or its 15-second timer. When Telegram sync is disabled, it returns without Telegram effects. When enabled, it checks token and owner pairing, reads projects, optionally reads Lane Pilot tasks, initializes topics only after explicit consent, reconciles topics, queues events and delivers the queue. (server.ts:436-480), (server.ts:1194-1228), (server.ts:510-550), (server.ts:604-700)
5. A separate chat service creates `ChatBridge` only when both project sync and chat are enabled. It passes BB SDK, Telegram transport, owner lookup, optional spool, language, Rich Replies, confirmation preference and voice transcription. When either flag is off, it aborts and disposes the bridge and publishes the companion control as disabled. (server.ts:1260-1311)
6. The Telegram ingress service pauses while project sync is off or while chat is enabled but the paired owner's bridge is not ready. Otherwise it polls updates from the saved offset, routes each update, persists pairing or accepted chat input, handles `/tasks`, and advances the offset. (server.ts:1374-1441)

| Plugin branch | Condition | Result |
|---|---|---|
| Sync disabled | `enabled` is false. | Sync returns before Telegram work; ingress pauses for five seconds. (server.ts:446-447), (server.ts:1388-1393) |
| Sync enabled, chat disabled | `enabled` true, `chatEnabled` false. | Project/event sync runs; chat bridge is disposed; ingress can still receive `/tasks` and reply that chat is disabled for chat-shaped input. (server.ts:1271-1311), (server.ts:1425-1435) |
| Sync and chat enabled | Both flags true. | Bridge is created/reused. Once an owner is paired, ingress waits for it before consuming updates; before pairing, ingress continues to accept the pairing command. (server.ts:1271-1305), (server.ts:1388-1405) |
| No owner/token or Telegram configuration failure | Token absent, owner unpaired, invalid Telegram response, webhook conflict or competing poller. | Sync records an error or returns; unpaired ingress remains available for pairing. Polling errors are recorded and retried with backoff from 10 seconds up to five minutes. (server.ts:453-455), (server.ts:1443-1449) |

### Lane Pilot reader (`lanePilotReader`)

1. The returned reader calls `list_runs` with project ID, offset zero, configured page size (default 10), and `pinOpen: true`, then validates the response. A malformed response throws to the caller. (adapters.ts:101-122), (adapters.ts:138-143)
2. For each run, it keeps the highest `attempt_no` per task ID. That latest attempt supplies task status, attempt ID, blocked reason and run update time. (adapters.ts:145-169)
3. It fetches a run card only when a title is missing from its in-memory cache and the run is not closed/accepted or was updated within the previous hour. Successful card titles are cached by run and task. (adapters.ts:138-140), (adapters.ts:151-159)
4. It returns the task ID when a title is missing or card lookup fails, truncates a blocked reason to 300 characters, and clears the title cache if it grows beyond 5,000 entries. (adapters.ts:157-172)

| Reader branch | Condition | Outcome |
|---|---|---|
| Attempt status | `accepted`, `canceled`, `blocked`, `queued`, or another state. | Maps to `done`, `canceled`, `blocked`, `todo`, or `in_progress` respectively. (adapters.ts:127-133) |
| Run card lookup | Title missing and run live/recent. | Fetch and cache card titles; failed/null card falls back to task ID. (adapters.ts:151-169) |
| Old closed run | State is `closed` or `accepted` and last update is older than one hour. | Skip card lookup; produce IDs as titles if no cache entry exists. (adapters.ts:151-165) |
| RPC/schema failure | `list_runs` fails or its response does not match the schema. | Reader rejects. Caller distinguishes an unavailable plugin RPC from a bad shaped response and resets its poll timestamp for retry. (adapters.ts:140-143), (server.ts:314-316), (server.ts:491-507) |

### Chat bridge (`ChatBridge`)

1. The bridge receives its store, BB SDK, owner-scoped Telegram transport, abort signal and callbacks for language, Rich Replies, wakeups and transcription. It persists a binding per Telegram topic. If no binding exists, it can derive a ready project binding from a live `proj_` topic; other topics have no implicit binding. (chat.ts:129-160), (chat.ts:164-195)
2. `accept` validates the input schema, verifies both owner and chat IDs against the paired owner, and inserts an inbox record only when that Telegram update ID has not been seen. Spool imports are ordered by numeric update ID and remove a file only after durable acceptance. (chat.ts:307-337)
3. `tick` imports any spool, processes pending records in update order, permits one active lane per topic and at most four topics at once, and marks each record claimed before calling the handler. It also observes BB output, flushes Telegram outbox entries and prunes completed records. (chat.ts:357-435)
4. `handleInput` rejects missing, used, expired, wrong-topic or stale-revision callbacks. Valid actions are marked used before dispatch. Text in a bound thread first checks pending BB interactions; a pending question blocks ordinary text and directs the owner to its answer controls. (chat.ts:940-988), (chat.ts:1135-1161)
5. With an existing thread, valid text uses `threads.send`. Without one, the bridge either asks for explicit confirmation when configured or resolves the environment and spawns a visible BB thread, then saves its ID in the topic binding. A selected CLI profile is revalidated and added as a one-time selection marker to the first prompt. (chat.ts:1162-1221)
6. Voice/audio input calls the supplied transcription function before the text is handled; BB thread output is observed and queued to the same topic. The bridge reports status for bindings, pending inbox items, unsent output and delivery errors. (chat.ts:129-160), (chat.ts:395-435), (chat.ts:1881-1901)
7. Outgoing text is chunked and sent in FIFO order, at most eight queued records per flush. Per-part receipts let a later flush skip chunks already confirmed by Telegram. Rich-send or edit `telegram_400` falls back to `sendMessage`; other delivery errors retain the outbox item with `retryAt` and stop that flush. (chat.ts:1791-1880)

| Chat branch | Condition | Outcome |
|---|---|---|
| No binding | Topic is an active project topic. | Derive and persist a ready binding with no thread; otherwise show project selection. (chat.ts:173-195), (chat.ts:973-1030) |
| New conversation | Binding has no thread and is ready. | Optional confirmation stores/replaces a draft; confirmation starts a thread with the saved draft. (chat.ts:1162-1179) |
| Existing conversation | Binding has a thread and no pending interaction. | Send text using BB `threads.send` in auto mode. (chat.ts:1141-1161) |
| Pending interaction | BB reports a pending interaction on the bound thread. | Do not send ordinary text; prompt for a button or a reply to the question card. (chat.ts:1141-1155) |
| Invalid callback | Action is absent, used, expired, for another topic or an old binding revision. | Report stale button and return without running the action. (chat.ts:973-988) |
| Handler failure or restart during claim | Action throws, or recovery finds an inbox item still claimed. | Queue a check-status message; mark the record done and clear text/voice so an unknown external mutation is not blindly replayed. (chat.ts:339-355), (chat.ts:371-388) |
| Telegram output failure | Rich message/edit returns `telegram_400`; other Telegram or transport error. | For 400, send plain text; otherwise retain output, record error/retry delay and stop the flush. Confirmed chunk receipts prevent replay of prior parts. (chat.ts:1803-1819), (chat.ts:1845-1877) |

### Companion process (`main`)

1. `main` applies a restrictive process umask, reads the private bot config, and fails startup if the owner ID differs, the service is disabled, or the token is not a string. It opens the SMS source database read-only and creates the local delivery database/table with secure-delete enabled. (companion/aivech/src/main.ts:11-31)
2. It watches the config token for replacement, prepares a status receipt, starts the grammY bot, verifies the bot ID, and refuses to proceed when Telegram reports an existing webhook. (companion/aivech/src/main.ts:32-43), (companion/aivech/src/main.ts:60-81)
3. With `--demo`, it sends one formatted sample message with a copy-code button, records the Telegram result and closes both databases; it does not enter the polling/SMS loop. (companion/aivech/src/main.ts:83-133)
4. In normal mode, `cfg.polling !== false` starts grammY polling for messages and callbacks. When false, polling is omitted and the process remains in SMS send-only mode; the SMS delivery loop still runs. (companion/aivech/src/main.ts:134-163)
5. Every loop removes outbox rows older than one hour, reads source SMS rows from the last hour in ID order, inserts a delivery receipt by fingerprint if absent, and skips records already sent or not yet due. (companion/aivech/src/main.ts:162-187)
6. It formats and sends eligible SMS to the owner, optionally into the configured SMS topic, then saves Telegram message ID and sent time. Failed sends increment attempts and set next retry: Telegram 429 uses `retry_after` (60 seconds if absent), other failures use capped exponential backoff. It writes service status and sleeps two seconds before the next iteration. (companion/aivech/src/main.ts:188-223)
7. SIGINT/SIGTERM stops the bot loop; shutdown waits for polling, writes a final receipt and closes both databases. (companion/aivech/src/main.ts:157-160), (companion/aivech/src/main.ts:224-235)

| Companion mode or failure | Condition | Outcome |
|---|---|---|
| Invalid configuration | Wrong owner, disabled service or non-string token. | Startup throws before opening the inbox/outbox. (companion/aivech/src/main.ts:15-23) |
| Wrong bot or active webhook | `getMe` ID differs from configured bot, or webhook URL is non-empty. | Startup fails; it does not start polling. (companion/aivech/src/main.ts:74-81) |
| Demo | Process arguments include `--demo`. | Sends sample SMS rendering, writes demo receipt and exits after closing DBs. (companion/aivech/src/main.ts:83-133) |
| Polling enabled | Config `polling` is anything except `false`. | Starts Telegram receiver; polling failure records `polling_failed`, marks stopping and sets nonzero exit code. (companion/aivech/src/main.ts:135-156) |
| Send-only | Config `polling` is `false`. | No `getUpdates`; SMS delivery continues from the same loop. (companion/aivech/src/main.ts:135-163) |
| SMS send failure | Telegram 429, other Telegram error or network failure. | Keeps the delivery unsent, records retry time and error category; later loop retries when due. (companion/aivech/src/main.ts:181-216) |
| Local queue failure | Inbox/outbox work throws outside a single send. | Records `local_queue_error`, writes status receipt and continues after the loop delay. (companion/aivech/src/main.ts:218-223) |

## Modes

| Mode | Input and behavior | Output |
|---|---|---|
| Project and task notifications | Project sync enabled; event rules select event kinds, sound and projects. Task state is derived from latest attempt. (events.ts:15-31), (adapters.ts:127-169) | Per-project topic event cards; blocked worker errors carry the available reason. (model.ts:155-172) |
| Agent reports | `reportMode` is `full` or `summary`; summary state tracks pending/done/failed. (server.ts:214-234), (model.ts:29-34) | Full thread reply or summary card, with fallback behavior managed by the delivery path. (server.ts:740-780) |
| Telegram chat | Chat enabled and owner paired; topic binding can target an existing or new BB thread. (server.ts:163-171), (chat.ts:164-195) | BB output returns to the binding's Telegram topic. (chat.ts:129-160) |
| Companion SMS | Optional companion process configured with SMS inbox access. (companion/aivech/src/main.ts:20-30) | SMS is delivered to the owner's private chat; delivery state is stored in the companion outbox. (companion/aivech/src/main.ts:24-31), (companion/aivech/src/main.ts:44-58) |

## Capabilities

- **Owner pairing:** private `/start <code>`; expiry and code format are documented in [Gotchas](gotchas.md). (server.ts:338-352)
- **Project topics:** explicit initialization, one topic per visible project, plus navigation and optional SMS topic. Name length is owned by the [Data model](data-model.md). (server.ts:510-548), (model.ts:190-192)
- **Task notifications:** Lane Pilot task states and read limits are owned here: latest attempt status mapping, open-run pinning, and run-card title lookup. (adapters.ts:127-175)
- **Chat text and callbacks:** ingress length/schema bounds are documented in [Usage](usage.md); callbacks use the `bb:` namespace and stored revisioned actions. (ingress.ts:33-69), (chat.ts:196-212)
- **Voice/audio and message output:** size, duration and output chunking limits are owned by [Usage](usage.md). The bridge uses BB voice transcription. (adapters.ts:176-226), (chat.ts:108-118)
- **Companion commands:** `/projects`, `/tasks`, and `/status` behavior and display bounds are owned in [Usage](usage.md). (companion/aivech/src/bot.ts:41-45), (companion/aivech/src/projects.ts:55-107)
- **Localization:** UI and bot strings use Russian or English selection; English text falls back to the source string when no dictionary entry exists. (server.ts:152-156), (locale.ts:232-234)

## Failures and compensation

- Invalid, non-private, or foreign updates are ignored; another private sender after pairing receives only the configured stranger response path, not conversation forwarding. (ingress.ts:23-35)
- Unsupported message types produce a polite refusal; photos/documents are accepted as chat-shaped input but only voice/audio metadata is passed to transcription. (ingress.ts:45-69)
- A failed project read does not reconcile or delete topics; ambiguous topic creation is left marked as uncertain instead of automatically creating a duplicate. (server.ts:477-480), (model.ts:212-236)
- Telegram errors classified as retryable include network/invalid response errors and server failures; retry delay uses `retry_after` or a 30-second default. (adapters.ts:41-65)
- A companion update is written by atomic temp-file replacement and directory fsync; a duplicate update ID is treated as already spooled. (companion/aivech/src/chat.ts:62-81)
- Task reads distinguish unavailable Lane Pilot RPC from an invalid response shape, and a missing run card falls back to task ID as title. (server.ts:314-316), (adapters.ts:151-159)

## Related pages

- [Usage](usage.md)
- [Architecture](architecture.md)
- [Data model](data-model.md)
- [Gotchas](gotchas.md)
- [Deployment](deployment.md)

<!-- lane-pilot:backlinks -->
## Referenced by

- [Architecture](architecture.md)
- [Data model](data-model.md)
- [Gotchas](gotchas.md)
- [Native CLI agent profiles](profiles-0.4.md)
- [Telegram integration research](research.md)
- [Roadmap and release state](roadmap.md)
- [Use BB from Telegram](usage.md)
