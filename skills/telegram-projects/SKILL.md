---
name: telegram-projects
description: "Operate the personal BB Telegram bridge: project topics, connected chats, voice and Tasks notifications."
---

# Telegram Projects

Use `bb telegram-projects status --json` and `chat-status --json` for diagnostics. `sync` reconciles project topics and Tasks; `menu <project-id>` sends the chat menu to that project's main topic. `test <project-id>` sends a labelled Tasks test. `bind <project-id|sms|navigation> <topic-id>` repairs a main topic after verifying its identity. `chat-forget <topic-id>` removes only its conversation binding, preserving history.

The owner's Telegram menu supports /project, /projects, /menu, /chats, /new, /model, /section, /history, /stop, /disconnect and /tasks. Additional Telegram topics bind through /project. A new session starts on its first text/voice message; existing sessions connect explicitly and remain visible in BB. Only bound threads and Tasks are observed. Do not attach unrelated or hidden chats automatically.

Settings chatEnabled and richReplies control conversations and native Rich Messages. Incoming text/voice uses the existing owner-only companion, a durable local spool, and BB SDK. It is the only Telegram poller: never start another getUpdates/webhook receiver with the token. Voice uses BB system.transcribeVoice; do not request separate credentials. Questions depend on provider support; complex forms link to BB.

Personal host paths and IDs remain fixed; token stays in the private config. Keep plugin storage on updates. Unknown mutation outcomes must be checked, not automatically replayed. Read README.md and docs/usage.md in the source repository for limits and recovery. Never print token values or private message queues.

Version 0.3 adds settings directly in the Telegram nav panel: language ru/en, delivery/chat flags, public BB URL, read-only BotFather diagnosis and same-bot token rotation. Never return credentials. getMe exposes has_topics_enabled and allows_users_to_create_topics; Restrict bot usage needs manual inspection. Do not enable Bot Management/Bot-to-Bot for BB-internal agent communication. Language changes new service text and menus, not user content.
