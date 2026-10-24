---
title: Gotchas
type: gotchas
created: 2026-10-24
updated: 2026-10-24
status: active
confidence: medium
tags: [gotchas, telegram, operations]
sources:
  - ingress.ts
  - model.ts
  - server.ts
  - adapters.ts
  - chat.ts
  - companion/aivech/src/main.ts
  - companion/aivech/src/projects.ts
---

# Gotchas

TL;DR: Telegram identity, receiver ownership, topic initialization and persisted binding revisions constrain plugin and companion operations. (ingress.ts:11-35), (model.ts:206-247)

## Critical

### Only one update poller can own a bot token

**Problem:** The plugin and companion can both poll Telegram updates; the companion polls unless configured send-only and refuses a configured webhook. (server.ts:608-650), (companion/aivech/src/main.ts:74-81), (companion/aivech/src/main.ts:135-143)

**Risk:** Two active `getUpdates` consumers conflict over the same bot token.

**Workaround:** Run one polling receiver for a token. When the plugin owns updates, set the companion to SMS send-only mode. (companion/aivech/src/main.ts:135-143)

### Pairing and owner checks are private-chat only

**Problem:** The router requires private chat and sender ID equal to chat ID; before pairing it accepts only the active `/start <code>`. (ingress.ts:23-35)

**Risk:** Group messages, callbacks from other users and messages from an unpaired identity do not reach BB.

**Workaround:** Pair from the owner's private chat. Code format and lifetime are described in [Deployment](deployment.md). (server.ts:338-352)

## High

### Empty plugin storage does not create topics

**Problem:** A new state database reports `topics_not_initialized` until explicit topic initialization. (server.ts:510-518)

**Risk:** Sync does not create the project topics until the owner confirms initialization.

**Workaround:** Use **Create topics** in the plugin Overview. (server.ts:136-137), (server.ts:510-518)

### Ambiguous topic creation is left for inspection

**Problem:** A Telegram create request with an ambiguous outcome leaves the topic marked as `creating`; later calls fail with `topic_creation_uncertain`. (model.ts:212-236)

**Risk:** Automatically repeating the create could make a duplicate topic.

**Workaround:** Inspect Telegram and plugin status before clearing or rebinding stored topic state. (model.ts:212-236)

### Hiding a project or folder deletes its topic and chat binding

**Problem:** Hidden projects/folders lead to Telegram topic deletion and binding cleanup. (server.ts:527-548)

**Risk:** The Telegram topic no longer remains available for that project binding.

**Workaround:** Review Project Folders visibility and the `hideWithFolders` setting before enabling hidden-project sync. (server.ts:368-380), (server.ts:485-486)

### Failed project reads are not deletion snapshots

**Problem:** Reconciliation uses the complete project list as its removal authority. (server.ts:477-480)

**Risk:** Treating an RPC failure as an empty list could remove valid topics.

**Workaround:** Preserve the last known project snapshot when reads fail. (server.ts:477-480)

## Medium

### Task cards use latest attempt and run-card title

**Problem:** Lane Pilot task status is derived from its newest attempt; a missing run card falls back to task ID. (adapters.ts:145-169)

**Risk:** A display title or state can differ from the run's top-level status.

**Workaround:** Check Lane Pilot for the source run; status mapping is listed in [Interaction flow](interaction-0.3.1.md). (adapters.ts:127-169)

### Companion projection is tied to the local installation

**Problem:** The companion validates fixed bot/owner IDs and reads personal paths. (companion/aivech/src/main.ts:11-32), (companion/aivech/src/projects.ts:19-32)

**Risk:** Copying the companion deployment does not make it a separate user's bot installation.

**Workaround:** Treat companion deployment paths and identity as installation-specific. (companion/aivech/src/main.ts:11-32)

## Low

### Expired callback buttons are rejected

**Problem:** Callback action IDs are tied to a topic and binding revision and expire; expired records are cleaned during ChatBridge ticks. (chat.ts:196-212), (chat.ts:420-435)

**Risk:** An old Telegram button does not execute after its binding changes or expiry.

**Workaround:** Open `/menu` again to get current controls. (chat.ts:973-988)

See [Data model](data-model.md) for persisted record lifecycles and cleanup.

<!-- lane-pilot:backlinks -->
## Referenced by

- [Architecture](architecture.md)
- [Data model](data-model.md)
- [Deployment](deployment.md)
- [Telegram interaction flow](interaction-0.3.1.md)
