# Changelog

## 0.11.0 — 2026-10-24

The Telegram part of the SMA map. Another person's private chat with the bot gets one sentence, once (the bot serves its owner only). A sticker, a location or a video note from the owner gets a polite refusal instead of silence. With chat off, a message is answered once an hour that talking to BB from Telegram is off. While BB works on a chat's reply, Telegram shows «typing». A failed getUpdates waits 10 s, doubling to 5 min, instead of 10 s every time. The pairing code is 8 characters and lives 10 minutes. The status says the link state (`off`, `awaiting_code`, `linked`). The new setting «Новый чат из Telegram — только после «да»» (`confirmNewChat`, off by default) keeps the first message of a new chat as a draft until a whole «да».

Часть карты SMA про Telegram. Чужой человек в личке бота получает одну фразу, один раз. На стикер, геометку или кружок владелец получает вежливый отказ, а не тишину. Если общение выключено, бот раз в час отвечает, что оно выключено. Пока BB готовит ответ, Telegram показывает «печатает». После сбоя getUpdates пауза удваивается от 10 с до 5 мин. Код сопряжения — 8 символов, живёт 10 минут. Статус называет состояние связи. Новая настройка `confirmNewChat` (по умолчанию выключена): первое сообщение нового чата ждёт целого «да».

## 0.10.0 — 2026-10-12

Task events now come from Lane Pilot instead of the BB Tasks plugin, which is switched off. The plugin reads each visible project's runs over the Lane Pilot RPC (`list_runs`, `get_run_card`), at most every 15 seconds. A task is its latest attempt: new, started, accepted (done), canceled, and blocked, which is the worker error alert with the block reason. Retries do not alert; each event is sent once. The first read of a project is silent, and the old Tasks snapshots are dropped. `/tasks` and the companion projection list open Lane Pilot tasks. The "needs review" and "due date changed" events are removed, since Lane Pilot has neither. The `tasks_cli_unavailable` problem is now `lane_pilot_unavailable`. No `bb` CLI calls remain.

События задач теперь берутся из Lane Pilot, а не из плагина Tasks, который выключается. Плагин читает ходы проектов по RPC Lane Pilot (`list_runs`, `get_run_card`) не чаще раза в 15 секунд. Задача — её последняя попытка: новая, начата, принята, отменена и заблокирована (это сигнал «Ошибка исполнителя» с причиной блокировки). Повторы попыток не шумят, каждое событие уходит один раз. Первое чтение проекта тихое, старые снимки Tasks удаляются. `/tasks` и проекция для companion показывают открытые задачи Lane Pilot. События «Нужна проверка» и «Изменён срок» убраны: в Lane Pilot их нет.

## 0.9.0 — 2026-10-02

Ready for any BB user. The bot owner is linked with a one-time `/start <code>` from the Connection tab instead of a built-in account; the bot identity is learned from its first token. No personal paths remain: the plugin's own receiver writes incoming messages straight to plugin storage, and the companion folder, SMS topic and time zone are optional settings. The default Env Catalog name is `TELEGRAM_BOT_TOKEN`. Every bot text has an English translation, checked by a test, so English switches the bot menu, topic introductions, cards and messages. README and overview rewritten in English and Russian; MIT license.

Готов для любого пользователя BB. Владелец бота привязывается одноразовой командой `/start <код>` с вкладки «Подключение», а не зашит в код; бот определяется по первому токену. Личных путей больше нет: приёмник плагина пишет входящие прямо в хранилище плагина, а папка компаньона, тема SMS и часовой пояс стали необязательными настройками. Имя токена в Env Catalog по умолчанию — `TELEGRAM_BOT_TOKEN`. У каждого текста бота есть английский перевод, это проверяет тест. README и обзор переписаны на английском и русском; лицензия MIT.

## 0.8.0 — 2026-10-02

Отчёты агентов отправляются нативными Rich Messages: шапка с проектом, разделом, агентом и временем, ответ агента — свёрнутым блоком, где Telegram сам рисует таблицы, заголовки, код и списки; при отказе Rich Messages уходит HTML-версия. Кнопка «🔌 Подключить здесь» подключает тред из отчёта к теме, не затирая сам отчёт. Режим саммери: модель BB, выбранная родным селектором провайдера и модели BB, пишет 3–6 пунктов в скрытом треде; саммери тоже свёрнуто, при задержке больше 3 минут приходит полный ответ. Инфоблок команд на вкладке «Обзор» и меню бота строятся из одного списка, меню сверяется с Telegram. Темы проектов называются без «📂», кнопка «Открыть BB» ведёт на страницу проекта. Исправлено: задача, созданная и закрытая между двумя опросами, теперь даёт и «Задача завершена».

## 0.7.0 — 2026-10-02

Отчёты агентов в темы проектов по событиям BB `thread:changed`: закончил ход, ждёт ответа, остановлен или упал — с подписью проекта, раздела, треда и агента. Вкладка «События» заменяет флаги notifyTasks / notifyWorkerErrors / soundOnReview: каждое событие со своим звуком и фильтром проектов, прежние значения переносятся автоматически. Скрытие проекта или раздела в Project Folders удаляет его тему из Telegram. Страница плагина разделена на вкладки «Обзор», «События», «Темы», «Подключение», «Общие».

## 0.6.0 — 2026-10-02

Работа на хабе после переезда BB. Токен бота берётся из Env Catalog (`TG_AIVECH_BOT`) или задаётся вручную как секретная настройка плагина; закрытый файл `aivech.json` плагину больше не нужен. Плагин сам принимает updates (`telegram-ingress`) и отвечает на `/tasks`; companion переведён в режим только отправки SMS. Пустая база плагина больше не создаёт полный набор тем рядом с существующими: создание ждёт явного подтверждения, `bind` принимает существующую тему. Страница плагина оформлена в стиле Pokecut.

## 0.2.0 — 2026-09-12

Двусторонний транспорт через единственный companion-poller и постоянную очередь. Меню проектов, дополнительные темы, создание и подключение сессий BB, выбор разделов/агентов/моделей, остановка, последний ответ, голос через BB transcription, native Rich Messages, обновляемый статус и обработка простых вопросов/разрешений. Старые кнопки и ответы из прежней привязки больше не выполняют действие в новом разговоре. Сквозной тест текста, повторного подключения и голоса пройден.


## 0.1.0 — 2026-09-12

Первая персональная версия: синхронизация проектов с темами Telegram, уведомления Tasks, постоянная очередь доставки, страница BB и CLI для диагностики/восстановления. Снимок companion-сервиса с командами и маршрутизацией SMS. Документированы исследование рынка, архитектура двустороннего транспорта и этапы развития.

Общение с BB, управление сессиями, разрешения из Telegram, транскрибация и native Rich Messages ещё не входят в эту версию.
