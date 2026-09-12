# Interaction update 0.3.1

Folder buttons display section names, without filesystem paths. The BB settings panel owns a height-constrained scroll area so its Save control remains reachable.

The grammY companion already used long polling and answered callbacks promptly. The delay was downstream: BB inspected the durable spool every two seconds, and asynchronous handling could leave a reply waiting for another tick. Filesystem notifications now wake the consumer, and queued output/lane completion wake delivery. A two-second fallback recovers missed notifications; thread observation remains throttled separately. No second Telegram poller was introduced.

Navigation callbacks edit their original message. New commands, agent replies, questions and history remain separate messages. Callback revision/one-use checks and per-topic ordering remain. Definitive edit rejection falls back to a replacement; uncertain failures retain existing retry rules. Callback acknowledgement is silent, without a repetitive “Received” toast.

## Documentation reviewed

[grammY interactive menus](https://grammy.dev/plugins/menu): menu navigation, automatic callback answers and coordinated text/keyboard edits. The menu plugin is useful when grammY owns rendering; here rendering and durable actions live in BB, so the same Bot API edit mechanism is used without migrating action ownership.

[grammY long polling](https://grammy.dev/guide/deployment-types) and [runner](https://grammy.dev/plugins/runner): long polling does not impose a two-second wait. Runner enables concurrent ingestion at larger scale; it does not fix a downstream queue timer. Current owner-only handlers stay short, while BB serializes actions per topic.

[Telegram Bot API 10.3](https://core.telegram.org/bots/api#richmessagebutton) adds styled buttons inside rich blocks and inline text; callbacks retain the same data mechanism. Other relevant capabilities include collapsible details, compact tables, rich drafts and stop controls. Rich buttons can improve layout but cannot remove server/network latency. Ephemeral flows mainly benefit shared chats. These additional rich layouts are researched, not enabled in this release.

## Verification

31 plugin tests and 6 companion tests; tsc/build passed. Live owner-only /section returned buttons “Корень проекта”, “Плагины”, “В меню”. Clicking “В меню” edited the same message: callback acknowledgement 169 ms, observed edit 364 ms in one sample including network/poll-read overhead. This is not a latency SLA.

Actual app.tsx and built CSS rendered against installed RPC inside a 420px clipped parent: content 1606px, scroll worked; Save was fully visible at y=192–228 after scrolling. Screenshot inspected. Full authenticated BB Connect shell was not exercised by the automation browser.
