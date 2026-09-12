import { chatEnabled, saveChatUpdate } from "./chat.js";
import { Bot, Context } from "grammy";
import { projectList, taskList, syncStatus } from "./projects.js";
export const OWNER_ID = 259034221;
export const BOT_ID = 8461763634;
export function isOwner(ctx: Pick<Context, "from" | "chat">): boolean {
  return (
    ctx.from?.id === OWNER_ID &&
    ctx.chat?.id === OWNER_ID &&
    ctx.chat.type === "private"
  );
}
export function createBot(
  token: string,
  status: () => string,
  bridge = { enabled: chatEnabled, save: saveChatUpdate },
) {
  const bot = new Bot(token, { client: { timeoutSeconds: 40 } });
  // This gate precedes EVERY module. Groups and all other users are ignored.
  bot.use(async (ctx, next) => {
    if (isOwner(ctx)) await next();
  });
  bot.use(async (ctx, next) => {
    if (bridge.enabled() && bridge.save(ctx)) {
      if (ctx.callbackQuery)
        await ctx.answerCallbackQuery({ text: "Принято" }).catch(() => {});
      return;
    }
    await next();
  });
  const reply = (ctx: Context, text: string) =>
    ctx.reply(text, { message_thread_id: ctx.msg?.message_thread_id });
  bot.command(["start", "help"], (ctx) =>
    reply(
      ctx,
      "🧭 Рабочее пространство Кирилла\n\n📂 Темы проектов — события Tasks: запуск, проверка, завершение, ошибки исполнителей и сроки.\n📱 SMS — сообщения на телефон и кнопки копирования кодов.\n\n/projects — проекты\n/tasks — активные задачи в текущей теме\n/status — состояние сервисов\n\nОбычные чаты BB сюда не пересылаются.",
    ),
  );
  bot.command("projects", (ctx) => reply(ctx, projectList()));
  bot.command("tasks", (ctx) =>
    reply(ctx, taskList(ctx.msg?.message_thread_id)),
  );
  bot.command("status", (ctx) => reply(ctx, status() + syncStatus()));
  bot.catch((e) => {
    console.error("Telegram update processing failed; private content omitted");
    throw new Error("telegram_ingress_failed");
  });
  return bot;
}
