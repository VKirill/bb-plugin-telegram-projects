---
name: telegram-projects
description: Inspect or operate synchronization of BB projects and Tasks notifications with the owner's personal Telegram bot.
---
# Telegram Projects

Use `bb telegram-projects status --json` for mappings and errors; `bb telegram-projects sync --json` to reconcile now. The plugin creates/renames topics for BB projects and deletes their complete Telegram topic history after project deletion when deleteTopics is enabled. Disabling the plugin never deletes topics.

Use Tasks linkedBbProjectId to route notifications. Only Tasks metadata and attached-worker status are observed; do not add ordinary chat text or general thread events to notifications.

`bb telegram-projects test <project-id>` sends an explicitly marked demo; use only during user-authorized bot setup/testing. `bb telegram-projects bind <project-id|sms|navigation> <topic-id>` recovers an existing topic after checking its identity; it renames that topic. A topic with creating=true has an uncertain API result: inspect Telegram before binding, never blindly repeat creation.

Settings are in the plugin settings page. configFile/projectionFile/cliPath are server-local paths, never paths on the invoking remote client. The token is in the private configFile, not in CLI output. This integration fixes @aivech_bot and its owner; do not expand the audience without an explicit request.

The existing aivech launchd service owns polling and SMS. Never start a second getUpdates process. See the plugin README for recovery and limitations.
