---
title: Version 0.2 verification
type: gaps
created: 2026-09-12
updated: 2026-10-24
status: active
confidence: low
tags: [verification, telegram, voice]
sources:
  - test/ingress.test.ts
  - chat.ts
  - adapters.ts
  - ingress.ts
---

# Version 0.2 verification

TL;DR: The verification record covers a live text and voice conversation and notes that a real provider-generated approval was not confirmed. The ingress and voice limits are enforced in code. (test/ingress.test.ts:8-105), (adapters.ts:176-186)

## Recorded local checks

The prior verification record reports TypeScript/build success and plugin plus companion tests for topic binding, chat, voice, interactions, queue recovery and Telegram retry handling. This page preserves that recorded result; this documentation refresh did not rerun those checks.

The current ingress tests cover owner text routing, rejection of other users/groups/foreign callbacks, `/tasks`, `bb:` callbacks, new topics, pairing and unsupported sticker refusal. (test/ingress.test.ts:8-105)

## Recorded live check

The owner sent `/project` in a test topic, selected a project/model and sent a prompt. The record reports that the message created a BB thread and the reply arrived as a Telegram Rich Message. The owner then disconnected and reconnected the thread, sent synthetic OGG/Opus voice, and received the transcription result in that thread.

The live check did not confirm a provider-generated structured approval/question. Mock SDK tests were used for supported interaction payloads; complex forms were directed to BB. The current bridge's voice input is still limited to 15,000,000 bytes and 600 seconds before transcription. (adapters.ts:176-186)

## Limits recorded

The live check did not cover every model, permission form, Telegram client or provider. The repository's ingress contract still rejects group and foreign-user updates before chat processing. (ingress.ts:23-35), (test/ingress.test.ts:32-51)

<!-- lane-pilot:backlinks -->
## Referenced by

- [Roadmap and release state](roadmap.md)
