// One list feeds the bot menu (setMyCommands) and the help block on the plugin page.
export type BotCommand = {
  command: string;
  group: "topics" | "chat" | "agent" | "tasks";
  ru: string;
  en: string;
  hintRu: string;
  hintEn: string;
  /** Needs an argument: documented on the page, kept out of the Telegram menu. */
  args?: string;
};
export const BOT_COMMANDS: BotCommand[] = [
  {
    command: "menu",
    group: "topics",
    ru: "Меню чата",
    en: "Chat menu",
    hintRu:
      "Карточка темы: подключённый чат, сервер, агент, модель, раздел и кнопки управления. То же делают /start, /help и /status.",
    hintEn:
      "Topic card: connected chat, server, agent, model, section and controls. /start, /help and /status do the same.",
  },
  {
    command: "project",
    group: "topics",
    ru: "Привязать тему к проекту",
    en: "Bind this topic to a project",
    hintRu:
      "Выбор проекта BB для текущей темы. Новая тема, созданная вручную, привязывается так же.",
    hintEn:
      "Pick the BB project for this topic. A manually created topic is bound the same way.",
  },
  {
    command: "new",
    group: "chat",
    ru: "Новый чат",
    en: "New chat",
    hintRu: "Следующее сообщение начнёт новый тред BB в проекте этой темы.",
    hintEn: "The next message starts a new BB thread in this topic's project.",
  },
  {
    command: "chats",
    group: "chat",
    ru: "Найти и подключить чат",
    en: "Find and connect chats",
    hintRu: "Список тредов проекта с просмотром и подключением к теме.",
    hintEn: "Project threads with preview and connect.",
  },
  {
    command: "history",
    group: "chat",
    ru: "Последний ответ",
    en: "Last reply",
    hintRu: "Последний ответ подключённого треда.",
    hintEn: "Last reply of the connected thread.",
  },
  {
    command: "stop",
    group: "chat",
    ru: "Остановить запуск",
    en: "Stop the run",
    hintRu:
      "Останавливает работу агента после подтверждения. История сохраняется.",
    hintEn: "Stops the agent after confirmation. History is kept.",
  },
  {
    command: "disconnect",
    group: "chat",
    ru: "Отключить чат",
    en: "Disconnect this chat",
    hintRu: "Отвязывает тред от темы. Тред и история в BB остаются.",
    hintEn:
      "Unbinds the thread from the topic. The thread and history stay in BB.",
  },
  {
    command: "model",
    group: "agent",
    ru: "Агент и модель",
    en: "Agent and model",
    hintRu: "Провайдер и модель для нового чата.",
    hintEn: "Provider and model for a new chat.",
  },
  {
    command: "profile",
    group: "agent",
    ru: "Профиль агента",
    en: "Agent profile",
    hintRu: "Нативный профиль CLI-агента (Claude Code, OpenCode, Codex).",
    hintEn: "Native CLI agent profile (Claude Code, OpenCode, Codex).",
  },
  {
    command: "section",
    group: "agent",
    ru: "Выбрать раздел",
    en: "Choose a section",
    hintRu: "Папка Project Folders, в которой запустится новый чат.",
    hintEn: "Project Folders section where a new chat starts.",
  },
  {
    command: "server",
    group: "agent",
    ru: "Выбрать сервер",
    en: "Choose a server",
    hintRu: "Машина BB, на которой запустится новый чат.",
    hintEn: "BB machine where a new chat starts.",
  },
  {
    command: "tasks",
    group: "tasks",
    ru: "Активные задачи",
    en: "Active tasks",
    hintRu: "Открытые задачи Tasks проекта этой темы.",
    hintEn: "Open Tasks items of this topic's project.",
  },
  {
    command: "use",
    group: "chat",
    ru: "Подключить тред по ID",
    en: "Connect a thread by ID",
    hintRu: "Подключает конкретный тред BB к теме.",
    hintEn: "Connects a specific BB thread to the topic.",
    args: "<thread-id>",
  },
  {
    command: "say",
    group: "chat",
    ru: "Отправить текст как есть",
    en: "Send text as is",
    hintRu: "Передаёт агенту текст, даже если он начинается с /.",
    hintEn: "Sends text to the agent even if it starts with /.",
    args: "<text>",
  },
];
export const menuCommands = (language: "ru" | "en") =>
  BOT_COMMANDS.filter((c) => !c.args).map((c) => ({
    command: c.command,
    description: language === "en" ? c.en : c.ru,
  }));
