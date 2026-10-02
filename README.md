# Telegram Projects for BB

[![BB](https://img.shields.io/badge/BB-%3E%3D0.43-blue.svg)](https://getbb.app)
[![Plugin SDK](https://img.shields.io/badge/Plugin%20SDK-%3E%3D0.4.87-green.svg)](https://getbb.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Work with your BB agents from Telegram. Every BB project gets its own topic in a private chat with your bot: agents report there when they finish, stop or need an answer, Tasks events arrive in the same place, and you can talk to any BB thread by text or voice.

**English** · [Русский](#русский)

## What you get

- **Agent reports.** When an agent finishes a turn, waits for your answer or stops, its project topic gets a card with the project, section, thread, agent and time. The reply is collapsed; Telegram renders its tables, headings, code and lists natively.
- **Summaries.** Instead of the full reply, a BB model of your choice can write 3–6 points: what was done, the result, what needs attention. You pick provider, model and reasoning with BB's own model picker.
- **Connect from the report.** «🔌 Connect here» binds the reported thread to the topic. Your next messages go to that agent, and its answers come back to Telegram.
- **Chat with BB.** Start a new chat or connect an existing one in any project topic. Voice messages are transcribed by BB's transcription service.
- **Tasks events.** New tasks, status changes, completion, due dates and worker errors from the BB Tasks plugin.
- **Event rules.** Turn every agent and Tasks event on or off, with or without sound, for all projects or selected ones.
- **Project Folders aware.** Hiding a project or section in Projects & Sections removes its topic from Telegram.
- **Russian or English.** The plugin page, the bot menu, topic introductions, cards and bot messages follow the selected language.

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather). In *Bot Settings → Threads Settings* turn **Threaded Mode** on and **Disallow users to create new threads** off.
2. Install the plugin and open **Telegram** in the BB sidebar.
3. **Connection** tab: paste the bot token and press *Check and save token*. Alternatively store the token in Env Catalog under `TELEGRAM_BOT_TOKEN` (the name is a setting).
4. **General** tab: turn on *Project sync* and save.
5. **Connection** tab → *Owner*: open the shown link or send `/start <code>` to the bot. The bot answers only this Telegram account from then on.
6. **Overview** tab: press *Create topics*. One topic per BB project appears in the bot chat, plus a navigation topic.

## Bot commands

Commands work inside a project topic. The bot menu in Telegram is built from the same list, and the Overview tab shows whether Telegram serves it.

| Command | What it does |
| --- | --- |
| `/menu` | Topic card: connected chat, server, agent, model, section and controls |
| `/project` | Bind this topic to a BB project |
| `/new` | The next message starts a new BB thread |
| `/chats` | Find and connect an existing thread |
| `/history` | Last reply of the connected thread |
| `/stop` | Stop the agent after confirmation |
| `/disconnect` | Unbind the thread; history stays in BB |
| `/model`, `/profile`, `/section`, `/server` | Agent, model, CLI profile, folder and machine for a new chat |
| `/tasks` | Open tasks of the topic's project |
| `/use <thread-id>`, `/say <text>` | Connect a thread by ID; send text that starts with `/` |

## Requirements and costs

- BB 0.43 or later. The bot polls Telegram from the BB server, so the server needs outbound access to `api.telegram.org`. No webhook and no public port.
- Your own Telegram bot. Messages of connected chats, agent reports and task titles are sent to Telegram.
- Optional plugins: **Tasks** for task events, **Projects & Sections** for sections and hiding, **CLI Agents** for native agent profiles, **Env Catalog** for storing the token.
- Summaries and voice use the BB providers and transcription service you configured, with their usage costs.
- Telegram cannot hide a topic in a private bot chat, so hiding a project deletes its topic with its history; showing it again creates a new topic. *Delete topics of deleted projects* works the same way and can be turned off.

## Privacy

The bot token is stored as a secret plugin setting or read from Env Catalog; it is never returned to the plugin page. Only the paired Telegram account is served; groups and other users are ignored. Agent output for summaries is sent only to the BB model you choose.

## Advanced

- **Time zone** (General tab): times in cards use the BB server's zone unless you set one, for example `Europe/London`.
- **Companion service** (General → Advanced): a folder where the plugin writes its topic list and reads incoming messages of a companion process, plus an optional SMS topic. Not needed for normal use. The [companion example](companion/aivech/README.md) forwards SMS from a local inbox.
- CLI: `bb telegram-projects status|sync|test <project-id>|bind <project-id|navigation|sms> <topic-id>|chat-status|chat-forget <topic-id>`.

## Development

```sh
npm install
npm run check   # TypeScript
npm test        # unit tests
npm run build   # bb plugin build
```

[Changelog](CHANGELOG.md) · [Architecture](docs/architecture.md) · [Contributing](CONTRIBUTING.md) · [License: MIT](LICENSE)

---

## Русский

Работайте с агентами BB из Telegram. У каждого проекта BB своя тема в личном чате с вашим ботом: туда приходят отчёты агентов (закончил, остановился, ждёт ответа) и события Tasks, а с любым тредом BB можно переписываться текстом или голосом.

### Что умеет

- **Отчёты агентов** с проектом, разделом, тредом, агентом и временем; ответ свёрнут, таблицы, заголовки и код Telegram рисует сам.
- **Саммери** вместо полного ответа: выбранная в родном селекторе BB модель пишет 3–6 пунктов.
- **«🔌 Подключить здесь»** подключает тред из отчёта к теме, дальше переписка идёт с этим агентом.
- **Чат с BB**: новый чат или подключение к существующему, голос распознаёт BB.
- **События Tasks** и **правила событий**: каждое событие отдельно, со звуком или без, для всех или выбранных проектов.
- **Связь с Projects & Sections**: скрытый проект или раздел убирает свою тему.
- **Русский или английский**: страница, меню бота, вступления тем, карточки и сообщения бота переключаются вместе.

### Как подключить

1. Создайте бота в [@BotFather](https://t.me/BotFather), включите **Threaded Mode** и выключите **Disallow users to create new threads**.
2. Установите плагин и откройте **Telegram** в боковом меню BB.
3. Вкладка **Подключение**: вставьте токен и нажмите «Проверить и сохранить токен» или положите его в Env Catalog под именем `TELEGRAM_BOT_TOKEN`.
4. Вкладка **Общие**: включите «Синхронизацию проектов».
5. Вкладка **Подключение** → «Владелец»: откройте ссылку или отправьте боту `/start <код>`. Дальше бот отвечает только этому аккаунту.
6. Вкладка **Обзор**: нажмите «Создать темы».

Требования, стоимость и ограничения — в английском разделе выше: свой бот, исходящий доступ сервера BB к Telegram, необязательные плагины Tasks, Projects & Sections, CLI Agents и Env Catalog. В личном чате с ботом Telegram умеет только удалять темы, поэтому скрытие проекта удаляет его тему вместе с историей.
