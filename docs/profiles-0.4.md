---
title: Native CLI agent profiles
type: component
created: 2026-10-02
updated: 2026-10-24
status: active
confidence: medium
tags: [cli-agents, profiles, telegram]
sources:
  - chat.ts
  - commands.ts
---

# Native CLI agent profiles

TL;DR: For a new chat with a supported provider, the plugin can load CLI Agents profiles scoped to the selected project and execution target, then pass a one-time selection marker in the first prompt. (chat.ts:795-825), (chat.ts:1180-1209)

## Purpose

Let an owner choose a CLI Agents profile for a new Telegram-started BB thread without changing global CLI configuration. Profile data is stored in the topic binding and revalidated against its target before the new thread starts. (chat.ts:46-64), (chat.ts:1180-1209)

## How it works

1. After provider/model selection, ChatBridge resolves a host and working directory. For a selected section, it requires a matching BB environment at that folder path. (chat.ts:767-794)
2. It offers the profile picker only for new chats and provider IDs `codex`, `claude-code`, or `acp-opencode`; a connected thread returns to its menu. (chat.ts:795-800)
3. It checks that CLI Agents is installed and running, then calls its `catalog` RPC with target, project and provider. Missing plugin, unsupported catalog or empty list clears profile selection and reports the default agent path. (chat.ts:801-842)
4. The catalog is shown eight profiles per page, two per row, with a separate default row and bounded previous/next pages. Catalog failure shows retry and default options. (chat.ts:844-895)
5. Choosing a profile stores the profile ID and target in the binding. Choosing the default clears them. (chat.ts:1403-1427)
6. Before spawning the thread, the bridge recalculates the target and fails if it changed. It calls CLI Agents `select`, then prepends the returned selection token to the first prompt only. (chat.ts:1180-1209)

## Modes

| State | Inputs and behavior | Result |
|---|---|---|
| Supported provider, CLI Agents running | Project, provider and target-scoped catalog; page size 8. (chat.ts:795-825), (chat.ts:844-870) | Profile choices; default profile is always available. |
| Plugin absent, unsupported provider, or empty catalog | No supported selection to apply. (chat.ts:795-810), (chat.ts:826-842) | Selection cleared; BB default profile path. |
| Catalog failure | RPC/target resolution throws. (chat.ts:812-825), (chat.ts:884-895) | Retry and default controls. |
| Existing thread | Binding already has `threadId`. (chat.ts:795-800), (chat.ts:1405-1407) | Profile selection is unavailable for that thread. |

## Business rules

- A section profile target must resolve to the same project, host and exact folder path environment. (chat.ts:767-786)
- Provider or target changes clear the stored profile selection before use. (chat.ts:1390-1401), (chat.ts:1362-1398)
- Profile target is checked again before spawn; mismatch fails with `profile_target_changed`. (chat.ts:1182-1185)
- Profile selection is encoded into the initial user prompt only; it is not repeated as a global setting. (chat.ts:1186-1209)

## Public API or commands

The `/profile` command opens this picker. The ChatBridge calls CLI Agents RPC methods `catalog` and `select`; the RPC includes provider, project and host/environment/cwd target values. (commands.ts:83-90), (chat.ts:814-825), (chat.ts:1186-1200)

## Failures

- A missing section or environment fails target resolution; picker discovery errors return retry/default controls. (chat.ts:767-786), (chat.ts:884-895)
- If the provider, server or folder target changes after selection, the bridge clears or rejects the stale selection. (chat.ts:1390-1401), (chat.ts:1182-1185)
- If CLI Agents is not running, selection is reset and no CLI profile is applied. (chat.ts:801-810)

## Gotchas

- The selection belongs to a new thread; changing a profile does not mutate an existing thread. (chat.ts:795-800), (chat.ts:1405-1407)
- A section needs a matching registered environment, not only a folder path. (chat.ts:774-786)
- See [Interaction flow](interaction-0.3.1.md) for owner input routing and [Usage](usage.md) for the bot command set.

<!-- lane-pilot:backlinks -->
## Referenced by

- [Roadmap and release state](roadmap.md)
