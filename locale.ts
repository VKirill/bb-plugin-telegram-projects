// Telegram texts are written in Russian; English replaces them through this table.
export type Language = "ru" | "en";
export const english: Record<string, string> = {
  "❓ Агентство: нужен ответ": "❓ Agency: answer needed",
  "Агентство · уведомление": "Agency · notice",
  "Уведомления Tasks будут приходить в тему своего проекта. Это проверка доставки, не настоящая задача.": "Tasks notifications will arrive in their project topic. This is a delivery check, not a real task.",
  "Проверка настройки": "Setup check",
  "<b>🧭 Рабочее пространство BB</b>\n\n": "<b>🧭 BB workspace</b>\n\n",
  "\n\nВ темах проектов — чаты BB, отчёты агентов и уведомления Tasks.": "\n\nProject topics hold BB chats, agent reports and Tasks notifications.",
  "\n📱 SMS — коды и сообщения на телефон.": "\n📱 SMS — codes and messages sent to your phone.",
  "\n\n/project — привязать новую тему\n/chats — чаты BB\n/model — агент и модель\n/tasks — активные задачи\n/menu — управление": "\n\n/project — bind a new topic\n/chats — BB chats\n/model — agent and model\n/tasks — active tasks\n/menu — controls",
  "</b>\n\nЗдесь появляются события задач и отчёты агентов этого проекта: кто закончил работу, кто ждёт ответа, что остановилось.\n\n/menu — управление чатом BB\n/new — новая сессия\n/chats — подключиться к существующему чату\n/model — агент и модель\n/tasks — задачи проекта\n\nКакие события присылать, настраивается на странице плагина, вкладка «События».": "</b>\n\nTask events and agent reports for this project appear here: who finished, who is waiting for you, what stopped.\n\n/menu — BB chat controls\n/new — new session\n/chats — connect an existing chat\n/model — agent and model\n/tasks — project tasks\n\nChoose which events to send on the plugin page, Events tab.",
  "✅ Бот привязан к BB. Темы проектов появятся в этом чате в течение минуты.": "✅ The bot is linked to BB. Project topics will appear in this chat within a minute.",
  "✚ Новый чат": "✚ New chat",
  "💬 Чаты": "💬 Chats",
  "📍 Текущий": "📍 Current",
  "📖 Последний ответ": "📖 Last reply",
  "📁 Раздел": "📁 Section",
  "🤖 Агент / модель": "🤖 Agent / model",
  "⏹ Остановить": "⏹ Stop",
  Отключиться: "Disconnect",
  "📂 Все проекты": "📂 All projects",
  "Открыть чат в BB": "Open chat in BB",
  "⚠️ BB был перезапущен во время обработки сообщения. Исход действия не подтверждён. Открой /chats и проверь чат перед повторной отправкой.":
    "⚠️ BB restarted while processing the message. The outcome is unconfirmed. Open /chats and check before sending again.",
  "⚠️ Не удалось подтвердить действие. Проверь /status и /chats перед повтором; подробности доступны в BB.":
    "⚠️ Could not confirm the action. Check /status and /chats before retrying; details are available in BB.",
  "📂 Выбери проект. Новая тема будет привязана к нему.\n\nВнутри проекта: «Новый чат» или «Чаты» → подключиться → написать сообщение.\n/tasks — задачи; /menu — управление чатом.":
    "📂 Choose a project to bind this topic.\n\nInside a project: New chat or Chats → connect → send a message.\n/tasks — tasks; /menu — chat controls.",
  "\n\nСообщение здесь продолжит этот чат. Другие чаты проекта не пересылаются.":
    "\n\nMessages here continue this chat. Other project chats are not forwarded.",
  "✚ Новый чат: напиши первое сообщение.\nНастройки: ":
    "✚ New chat: send your first message.\nSettings: ",
  "по умолчанию BB": "BB default",
  "\nРаздел: ": "\nSection: ",
  "выбран в меню": "selected in menu",
  "корень проекта": "project root",
  "Чат отключён. Выбери «Новый чат» или «Чаты».":
    "Chat disconnected. Choose New chat or Chats.",
  "← Назад": "← Previous",
  "Далее →": "Next →",
  "В меню": "Menu",
  "💬 Чаты проекта\nВыбери чат, чтобы посмотреть его состояние и подключиться.\nСтраница ":
    "💬 Project chats\nChoose a chat to inspect its status and connect.\nPage ",
  "Раздел существующего чата сохраняется. Нажми «Новый чат», затем выбери раздел.":
    "An existing chat keeps its section. Choose New chat, then select a section.",
  "📁 Где создать новый чат?\nИнструкции и файлы будут взяты из выбранного каталога.":
    "📁 Where should the new chat be created?\nInstructions and files come from the selected directory.",
  "Корень проекта": "Project root",
  "Модель текущего чата можно выбрать ниже. Другой агент выбирается для нового чата.":
    "Choose the current chat model below. A different agent starts a new chat.",
  "Модель текущего чата": "Current chat model",
  "Другой агент → новый чат": "Different agent → new chat",
  "🤖 Агент для нового чата. Его модели берутся из настроек BB.":
    "🤖 Agent for the new chat. Models come from BB settings.",
  "По умолчанию BB": "BB default",
  "Модель ": "Model ",
  "Применится к текущему чату, когда он свободен.":
    "Applies to the current chat when it is idle.",
  "Применится к новому чату.": "Applies to the new chat.",
  "Кнопка устарела. Открой /menu.": "This button has expired. Open /menu.",
  "Меню отправлено в тему «": "Menu sent to topic “",
  "». Для отдельного разговора создай тему Telegram и выбери в ней /project.":
    "”. For a separate conversation, create a Telegram topic and use /project there.",
  "Сначала привяжи эту тему командой /project. В теме SMS сообщения не отправляются агенту.":
    "First bind this topic using /project. Messages in the SMS topic are not sent to an agent.",
  "Неизвестная команда. /menu — управление, /say /команда — отправить команду как текст агенту.":
    "Unknown command. /menu — controls; /say /command — send a command as text to the agent.",
  "Транскрибация сейчас недоступна. Отправь текст.":
    "Transcription is currently unavailable. Send text.",
  "Не удалось распознать голос. Отправь текст или проверь транскрибацию в настройках BB. Ограничение: 10 минут и 15 МБ.":
    "Could not transcribe the recording. Send text or check BB transcription settings. Limit: 10 minutes and 15 MB.",
  "🎙 Распознано:\n": "🎙 Transcribed:\n",
  "Отправь текст или голосовое сообщение. Вложения пока открывай в BB.":
    "Send text or a voice message. Open attachments in BB for now.",
  "В чате есть вопрос. Ответь через кнопку или ответом на его карточку. Если форма сложная — открой BB.":
    "The chat has a question. Use a button or reply to its card. Open BB for complex forms.",
  "📨 Сообщение принято BB. Ответ придёт сюда.\n/stop — остановить, /menu — текущий чат.":
    "📨 BB received your message. The reply will arrive here.\n/stop — stop; /menu — current chat.",
  "\n\nПодключение будет пересылать новые ответы и вопросы этого чата в текущую тему.":
    "\n\nConnecting forwards new replies and questions from this chat into this topic.",
  Подключиться: "Connect",
  "Последний ответ": "Last reply",
  "← Чаты": "← Chats",
  "Этот чат уже подключён к другой теме. Сначала отключи его там.":
    "This chat is already connected to another topic. Disconnect it there first.",
  "Смена модели доступна после завершения или остановки текущего запуска.":
    "You can change the model after the current run finishes or stops.",
  "Модель выбрана: ": "Model selected: ",
  "📖 Последний ответ\n\n": "📖 Last reply\n\n",
  "В этом чате ещё нет ответа.": "This chat has no reply yet.",
  "Остановить текущий запуск? Чат и история сохранятся.":
    "Stop the current run? The chat and history will remain.",
  "Да, остановить": "Yes, stop",
  Назад: "Back",
  "Команда остановки отправлена BB.": "Stop request sent to BB.",
  "Этот вопрос уже закрыт в BB.": "This question is already closed in BB.",
  "Ответ передан BB.": "Answer sent to BB.",
  "Вопрос относится к прежнему подключению. Открой /menu.":
    "This question belongs to a previous connection. Open /menu.",
  "Этот вопрос уже закрыт.": "This question is already closed.",
  "Для этого вопроса выбери кнопку или открой BB.":
    "Choose a button or open BB for this question.",
  "❓ BB ждёт ответа\n": "❓ BB needs your answer\n",
  "Требуется разрешение\n": "Permission required\n",
  "Разрешить один раз": "Allow once",
  Отказать: "Deny",
  "\n\nМожно ответить текстом через «Ответить» на это сообщение.":
    "\n\nYou can answer by replying to this message.",
  "\n\nНесколько вопросов: открой форму в BB.":
    "\n\nMultiple questions: open the form in BB.",
  "Эта форма открывается в BB.": "Open this form in BB.",
  "⚠️ Запуск завершился ошибкой. Подробности в BB.":
    "⚠️ The run failed. See details in BB.",
  "⏹ Запуск остановлен.": "⏹ Run stopped.",
  "нужен ответ": "answer needed",
  "Чат BB": "BB chat",
  Управление: "Controls",
  "В планах": "Backlog",
  "К выполнению": "To do",
  "В работе": "In progress",
  "Нужна проверка": "In review",
  Завершено: "Done",
  Отменено: "Cancelled",
  "🧪 Проверка уведомлений": "🧪 Notification test",
  "🔴 Ошибка исполнителя": "🔴 Worker error",
  "🆕 Новая задача": "🆕 New task",
  "▶️ Исполнитель начал работу": "▶️ Worker started",
  "📅 Изменён срок": "📅 Due date changed",
  "👀 Нужна проверка": "👀 Review needed",
  "✅ Задача завершена": "✅ Task completed",
  "⏹ Задача отменена": "⏹ Task cancelled",
  "🔄 Статус задачи": "🔄 Task status",
  "</b>\nСтатус: ": "</b>\nStatus: ",
  "🧭 Навигация": "🧭 Navigation",
  "\n\nВ темах проектов — чаты BB и уведомления Tasks.\n📱 SMS — коды и сообщения на телефон.\n\n/project — привязать новую тему\n/chats — чаты BB\n/model — агент и модель\n/tasks — активные задачи\n/menu — управление":
    "\n\nProject topics contain BB chats and Tasks notifications.\n📱 SMS — phone messages and codes.\n\n/project — bind a new topic\n/chats — BB chats\n/model — agent and model\n/tasks — active tasks\n/menu — controls",
  "<b>📱 SMS</b>\n\nЗдесь будут новые сообщения на телефон и кнопки копирования кодов.":
    "<b>📱 SMS</b>\n\nNew phone messages and code-copy buttons appear here.",
  "</b>\n\nЗдесь появляются события задач этого проекта.\n\n/menu — управление чатом BB\n/new — новая сессия\n/chats — подключиться к существующему чату\n/model — агент и модель\n/tasks — задачи проекта\n\nВ Telegram приходят только ответы подключённого чата и события Tasks.":
    "</b>\n\nTask events for this project appear here.\n\n/menu — BB chat controls\n/new — new session\n/chats — connect to an existing chat\n/model — agent and model\n/tasks — project tasks\n\nOnly connected chat replies and Tasks events are delivered to Telegram.",
  "Открыть BB": "Open BB",
  "Открыть в BB": "Open in BB",
  "🔌 Подключить здесь": "🔌 Connect here",
  "Открыть Telegram Projects": "Open Telegram Projects",
  "Открыть ": "Open ",
  Принято: "Received",
  "Синхронизация проектов ещё не настроена.":
    "Project sync has not been configured yet.",
  "📂 Проекты\n\n": "📂 Projects\n\n",
  "\n\nОткрой нужную тему в списке тем бота.\n/tasks — активные задачи в текущей теме.":
    "\n\nOpen the project in the bot’s topic list.\n/tasks — active tasks in this topic.",
  "Список задач пока недоступен.": "The task list is currently unavailable.",
  "в планах": "backlog",
  "к выполнению": "to do",
  "в работе": "in progress",
  "нужна проверка": "in review",
  "\n⚠️ Данные давно не обновлялись.":
    "\n⚠️ This data has not been updated recently.",
  "Активные задачи": "Active tasks",
  "Активных задач нет.": "No active tasks.",
  "\n\nЕщё ": "\n\nAnother ",
  " — в BB.": " — in BB.",
  "\n📂 Проекты: ": "\n📂 Projects: ",
  "\nСинхронизация: ": "\nSync: ",
  "\n📂 Синхронизация проектов ещё не подключена":
    "\n📂 Project sync is not connected yet",
  "📱 SMS на телефон · проверка оформления": "📱 Phone SMS · layout test",
  "📱 SMS на телефон": "📱 Phone SMS",
  "От: <b>": "From: <b>",
  "На номер: <code>": "To number: <code>",
  "Получено на Mini: ": "Received on Mini: ",
  "Код ": "Code ",
  Код: "Code",
  "<i>Это демонстрация, не настоящий код входа.</i>":
    "<i>This is a demo, not a real login code.</i>",
  "\n… Полный текст сохранён на Mini.": "\n… Full text is saved on Mini.",
  "📋 Скопировать код ": "📋 Copy code ",
  "📋 Скопировать код": "📋 Copy code",
  "✅ Бот работает на Mac mini\n📱 SMS: Новофон → Mini → Telegram\n🔒 Только твой личный чат\nВ очереди: ":
    "✅ Bot running on Mac mini\n📱 SMS: Novofon → Mini → Telegram\n🔒 Your private chat only\nQueued: ",
  "\nПоследняя ошибка: ": "\nLast error: ",
  "Проверка сервиса": "Service test",
  "номер Новофона": "Novofon number",
  "Проверка оформления. Код подтверждения: 123456. Это не настоящий код входа.":
    "Layout test. Verification code: 123456. This is not a real login code.",
  "готов к сообщению": "ready",
  выполняется: "running",
  запускается: "starting",
  "ожидает запуска": "pending",
  останавливается: "stopping",
  ошибка: "error",
  "окружение BB": "BB environment",
  "не указан": "unspecified",
  нет: "none",
  "данные устарели": "stale data",
  работает: "running",
  "\nСрок: ": "\nDue: ",
  "\nСрок снят": "\nDue date removed",
};
Object.assign(english, {
  "🖥 Сервер": "🖥 Server",
  "🎭 Профиль": "🎭 Profile",
  "🖥 Сервер: ": "🖥 Server: ",
  "нет папки проекта": "no project folder",
  "Сервер существующего чата сохраняется. Для другой машины создай новый чат.":
    "Existing chats keep their server. Create a new chat for another machine.",
  "🖥 Где запустить новый чат? Модели и профили будут взяты с выбранной машины.":
    "🖥 Where should the new chat run? Models and profiles come from that machine.",
  "На выбранном сервере для этого провайдера профили не найдены. Будет использован агент по умолчанию.":
    "No profiles were found for this provider on the selected server. The default agent will be used.",
  "Для этой машины ещё не настроена папка проекта в BB. Добавь источник проекта и повтори выбор сервера.":
    "This machine has no project folder configured in BB yet. Add a project source and select the server again.",
  "Страница ": "Page ",
  "🎭 Выбери профиль агента для нового чата. Модель уже выбрана.":
    "🎭 Choose an agent profile for the new chat. The model is already selected.",
  "Не удалось загрузить профили CLI Agents для выбранного раздела. Повтори выбор или используй настройки по умолчанию.":
    "Could not load CLI Agents profiles for this section. Retry or use defaults.",
  Повторить: "Retry",
  "🤖 Провайдер: ": "🤖 Provider: ",
  "🧠 Модель: ": "🧠 Model: ",
  "🎭 Профиль: ": "🎭 Profile: ",
  "📁 Раздел: ": "📁 Section: ",
  "Напиши первое сообщение, чтобы начать.": "Send your first message to start.",
});
export function translate(language: Language, text: string) {
  return language === "en" ? (english[text] ?? text) : text;
}
