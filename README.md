# Telegram Projects — BB в Telegram

Персональный плагин BB для @aivech_bot. **Версия 0.3.0**: темы проектов, уведомления Tasks и двустороннее общение с настоящими сессиями BB. На Mac mini работают плагин и отдельный companion, принимающий входящие Telegram-сообщения и доставляющий SMS.

## Настройки бота / Bot settings

Открой **Telegram** в боковом меню BB. На странице доступны проверка и замена токена текущего бота, диагностика BotFather, язык RU/EN, синхронизация, общение, Rich Messages, уведомления Tasks, звук, удаление тем и публичный URL BB. Нажми «Сохранить настройки», чтобы применить язык и поведение.

**Check connection** uses getMe/getWebhookInfo without sending messages. It reports token validity, bot identity, Threaded Mode, user-created topics and webhook conflicts. Enable Threaded Mode; disable “Disallow users to create new threads” for manual topics. Restrict bot usage is optional and can only be checked manually. Bot Management and Bot-to-Bot are not needed for BB agents. [Official API fields](https://core.telegram.org/bots/api#user).

Token replacement is restricted to the existing personal bot. It is saved atomically with mode 0600, never returned to the frontend. The receiver reloads its credentials through the existing launchd KeepAlive service. Another bot/owner requires a migration; this remains a personal plugin, not general marketplace onboarding.

Language applies to new menus, command descriptions, questions, progress and service notifications; user content and agent output are preserved. Managed topic introductions are updated. Already queued messages keep their original language. Russian remains the default.

## Начать

В теме проекта отправь `/menu`. Для нового разговора выбери «Новый чат» и напиши первое сообщение. Для существующего — `/chats` → чат → «Подключиться». Следующие сообщения и голос продолжают выбранную сессию, видимую и в BB.

Создай дополнительную тему в Telegram и отправь `/project`: выбери проект, затем `/model` для агента и модели. `/section` выбирает папку для нового чата. Меню команд доступно кнопкой Telegram. [Полная инструкция](docs/usage.md).

## Что работает

- Проект BB → основная тема Telegram. Создание/переименование синхронизируются; дополнительные пользовательские темы привязываются через `/project`.
- `/new`, `/chats`, `/use <thread-id>`, `/history`, `/disconnect`, `/stop`; список чатов с пагинацией и просмотром перед подключением. Остановка требует нажатия подтверждения; история сохраняется.
- Выбор провайдера и модели из BB, выбор каталога Projects & Sections для нового разговора. Существующий чат сохраняет своё окружение. Инструкции проекта загружает штатный провайдер BB.
- Голос до 10 минут/15 МБ: скачивание в память → настроенная транскрибация BB → сообщение в тот же чат. Распознанный текст виден в Telegram. Отдельного ключа транскрибации нет.
- Финальные ответы как native Rich Messages, текстовый fallback при отказе API. Статус — обновляемая карточка; внутренние рассуждения не извлекаются. Длинные ответы разбиваются на части.
- Штатные BB-вопросы с одним выбором или свободным ответом; allow-once/deny для разрешений. Сложные/множественные формы ведут в BB. Наличие таких вопросов зависит от провайдера и режима.
- Уведомления Tasks: новые задачи, статусы, работа исполнителя, сроки, ошибка прикреплённого worker. Подпроект определяется через linkedBbProjectId. Завершение worker само по себе не считается завершением задачи.
- Другие непривязанные переписки не наблюдаются. `/history` читает последний ответ только явно выбранного чата. Скрытые служебные workers не предлагаются для подключения.

## Установка и эксплуатация

Node.js 24+, BB 0.43+, SDK 0.4.84. `npm ci`, `npm run check`, `npm test`, `npm run build`, `bb plugin install .`.

У новой установки enabled=false и chatEnabled=false. Личная установка уже включена. [Companion](companion/aivech/README.md) развёртывается отдельно; не запускать второй polling-процесс с тем же токеном.

Настройки: enabled, chatEnabled, richReplies, configFile, projectionFile, cliPath, appUrl, deleteTopics, notifyTasks, notifyWorkerErrors, soundOnReview. При изменении configFile/appUrl требуется reload чат-транспорта. Страница BB: `/plugins/telegram-projects/telegram-projects`.

CLI:

- `bb telegram-projects status --json` — общая диагностика.
- `bb telegram-projects chat-status --json` — привязки, очереди, категории ошибок.
- `bb telegram-projects menu <project-id>` — отправить меню в основную тему проекта.
- `bb telegram-projects sync --json` — сверить проекты и Tasks.
- `bb telegram-projects test <project-id>` — тестовая карточка Tasks.
- `bb telegram-projects bind <project-id|sms|navigation> <topic-id>` — восстановить основную тему; сначала проверить её назначение.
- `bb telegram-projects chat-forget <topic-id>` — убрать только привязку разговора, сохранив BB/Telegram-историю.

## Хранение и восстановление

Персональные bot ID 8461763634 и owner ID 259034221 проверяются на обеих границах. configFile — закрытый JSON на сервере, с token, chat_id, enabled. Токен не передаётся браузеру или в Git. Пути персональной установки фиксированы; универсальный onboarding пока впереди.

Companion — единственный `getUpdates`-получатель. До завершения обработки он атомарно сохраняет update в mode-0600 файл `private/bb-chat-inbox`. Плагин переносит его в собственную SQLite и удаляет файл. Для одной темы действует последовательная обработка; разные темы обслуживаются независимо, максимум четыре одновременно. Обычные сообщения активному агенту передаются через BB send(mode=auto), то есть штатную очередь/steering BB.

Плагин хранит привязки, незавершённые входящие/исходящие сообщения, callback ID и квитанции. После обработки очищает текст входящего сообщения, после доставки — текст исходящего. Основные завершённые записи очереди удаляются через 7 дней; вспомогательные привязки/квитанции остаются в plugin storage. Кнопки истекают через сутки и проверяют поколение привязки; повторное нажатие не выполняет команду снова. Исходные Telegram-сообщения и история BB сохраняются в своих приложениях.

При обрыве после внешнего вызова невозможно гарантировать exactly-once. Неопределённое входящее действие не повторяется автоматически: бот предлагает проверить сессию перед повтором. При неопределённой отправке в Telegram возможен дубль; подтверждённые части не повторяются. 429 учитывает retry_after. После перепривязки отложенные ответы старого чата не отправляются в новый. При недоступном BB включённый companion сохраняет входящие до восстановления; это не подтверждение выполнения агентом.

## Удаление тем и границы

deleteTopics=true: удаление проекта удаляет **основную тему со всей историей** после отсутствия проекта минимум 30 секунд в успешных снимках. Дополнительные пользовательские темы автоматически не удаляются. Выключение плагина темы не удаляет. Не очищать plugin storage при обновлении: там привязки и очереди.

Опрос проектов/Tasks — каждые 15 секунд плюс сигнал изменения проекта; промежуточные статусы могут быть пропущены. Это обзор, не полный журнал Tasks. Ручное удаление темы Telegram требует восстановления привязки. Файлы/фото входящим транспортом пока не передаются агенту; сложные формы и полная история открываются в BB.

## Документы

[Инструкция](docs/usage.md) · [Проверка 0.2](docs/verification-0.2.md) · [Исследование аналогов](docs/research.md) · [Архитектура](docs/architecture.md) · [План развития](docs/roadmap.md) · [Разработка](CONTRIBUTING.md)

Репозиторий приватный, публичная лицензия не выбрана (UNLICENSED). В маркетплейс не отправлен.
