---
title: Use BB from Telegram
type: component
created: 2026-09-12
updated: 2026-10-24
status: active
confidence: medium
tags: [usage, telegram, chat]
sources:
  - commands.ts
  - ingress.ts
  - chat.ts
  - adapters.ts
  - companion/aivech/src/bot.ts
  - companion/aivech/src/projects.ts
---

# Use BB from Telegram

TL;DR: Pair the bot owner, open a project topic, and use its menu to start a BB thread or connect an existing thread. (ingress.ts:23-35), (chat.ts:129-160)

## Purpose

This page describes the Telegram commands and options for project topics, BB chat, voice input, and companion project/task queries. Plugin commands are declared in one menu table and handled by the chat bridge; the optional companion has a smaller separate command set. (commands.ts:12-71), (companion/aivech/src/bot.ts:33-45)

## How it works

1. Pair the Telegram account using the link or `/start <code>` shown in the plugin. Only private messages from the paired owner enter the chat flow. (ingress.ts:23-35)
2. Open a project's topic and send `/menu`, or create a Telegram topic and send `/project` to bind it to a project. A topic creation update is converted to `/project`. (ingress.ts:36-47)
3. Choose a new chat or an existing thread. ChatBridge stores a topic binding and keeps its project/thread IDs in plugin storage. (chat.ts:164-195)
4. Send text, a supported callback, or voice/audio. Text is capped at 16,000 characters; voice is transcribed by BB before it is sent to the thread. (ingress.ts:49-69), (adapters.ts:176-226)
5. Use `/history` for the last response, `/disconnect` to remove the binding, or `/stop` to stop the bound thread through its confirmation flow. These commands do not delete the BB thread. (commands.ts:12-71), (chat.ts:164-172)

## Command table

The plugin menu and handlers share the `BOT_COMMANDS` table; the Telegram menu is derived from the argument-free commands. (commands.ts:12-71), (commands.ts:134-138)

| Command | Action |
|---|---|
| `/menu` | Show topic chat status and controls. |
| `/project` | Bind a topic to a BB project. |
| `/new` | Select a new BB conversation for this topic. |
| `/chats` | Browse existing chats for the selected project. |
| `/history` | Show the latest response from the bound thread. |
| `/stop` | Request stop for the bound thread with confirmation. |
| `/disconnect` | Remove the Telegram-to-thread binding. |
| `/model`, `/profile`, `/section`, `/server` | Choose provider/model, CLI profile, project folder or server for a new conversation. |
| `/tasks` | Show Lane Pilot tasks for the topic's project in the plugin. |
| `/use <thread-id>` | Open a connection card for a thread ID. |
| `/say <text>` | Send text beginning with `/` to the agent. |

## Modes and options

| Choice | Behavior and limits |
|---|---|
| New conversation | Model/profile/section choices are held for the next new thread; the thread starts on the first user message. (chat.ts:129-160) |
| Existing conversation | Connecting stores the thread ID for this topic; prior history is not copied into Telegram by the binding operation. (chat.ts:164-195) |
| Voice/audio | Maximum 15,000,000 bytes and 600 seconds; the BB voice transcription adapter returns text for the chat bridge. (adapters.ts:176-226) |
| Long output | Split at 3,500 characters by default, preferring a newline boundary. (chat.ts:108-118) |
| Companion `/projects` | Lists project topics from its JSON projection. (companion/aivech/src/projects.ts:41-53) |
| Companion `/tasks` | Filters by current topic/project when possible, shows up to 12 items, and limits the response to 3,900 characters. (companion/aivech/src/projects.ts:55-92) |
| Companion `/status` | Shows companion queue/service status and projection freshness. (companion/aivech/src/bot.ts:45), (companion/aivech/src/projects.ts:94-107) |

## Business rules

- Only the owner in a private chat can use the plugin's chat bridge. (ingress.ts:23-35)
- A non-`bb:` callback is not forwarded to ChatBridge. (ingress.ts:33-35)
- `/tasks` is intercepted by the plugin route; it does not become a BB prompt. (ingress.ts:42-44)
- Disconnecting removes the binding value from storage; it does not issue a thread stop or deletion. (chat.ts:164-172)

## Failures

- A foreign owner identity fails validation before any BB action. (chat.ts:307-318)
- A failed action produces a status/chat recovery message; if the process restarts with an item still claimed, the update is marked done after its text and voice payload are removed. Check `/status` and `/chats` before resending. (chat.ts:339-355), (chat.ts:371-388)
- A voice file above the size or duration limit fails before the transcription request. (adapters.ts:176-186)
- A missing or unavailable companion projection returns a setup/unavailable message for `/projects` and `/tasks`. (companion/aivech/src/projects.ts:19-32), (companion/aivech/src/projects.ts:41-58)

## Public commands

The authoritative plugin command names and descriptions are in [commands.ts](../commands.ts); the companion owns `/projects`, `/tasks`, and `/status`. (commands.ts:12-71), (companion/aivech/src/bot.ts:33-45)

## Gotchas

- Sending an unrecognized slash command does not automatically send it to the agent; use `/say` for slash-prefixed prompt text. (commands.ts:12-71)
- Telegram routes plugin `/tasks` and companion `/tasks` to different handlers, depending on which process owns polling. The deployed receiver topology is described in [Architecture](architecture.md). (ingress.ts:42-44), (companion/aivech/src/bot.ts:42-44)
- Voice files over either limit fail before transcription. (adapters.ts:182-183)

See [Interaction flow](interaction-0.3.1.md) for the process across the plugin, BB and companion.

<!-- lane-pilot:backlinks -->
## Referenced by

- [Telegram interaction flow](interaction-0.3.1.md)
- [Telegram Projects overview](overview.md)
- [Native CLI agent profiles](profiles-0.4.md)
- [Roadmap and release state](roadmap.md)
