import { useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import type { z } from "zod";
import type { preferencesSchema, Diagnosis } from "./settings";
type Preferences = z.infer<typeof preferencesSchema>;
function Panel() {
  const rpc = useRpc<typeof rpcContract>();
  const [form, setForm] = useState<Preferences | null>(null),
    [present, setPresent] = useState(false),
    [token, setToken] = useState(""),
    [check, setCheck] = useState<Diagnosis | null>(null),
    [data, setData] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const en = form?.language === "en";
  const t = (ru: string, english: string) => (en ? english : ru);
  async function load() {
    try {
      const [p, s] = await Promise.all([
        rpc.call("preferences", null),
        rpc.call("status", null),
      ]);
      setForm(p);
      setPresent(p.tokenPresent);
      setData(s);
    } catch {
      setNotice("Не удалось загрузить настройки / Could not load settings");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch {
      setNotice(
        t(
          "Не удалось выполнить действие. Проверь подключение к BB.",
          "Action failed. Check your connection to BB.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  const input = "border rounded-md px-3 py-2 bg-background";
  const button = input + " disabled:opacity-50";
  const flags: [keyof Preferences, string, string, string, string][] = [
    [
      "enabled",
      "Синхронизация проектов",
      "Project sync",
      "Создавать темы проектов и доставлять уведомления.",
      "Create project topics and deliver notifications.",
    ],
    [
      "chatEnabled",
      "Общение с BB",
      "Chat with BB",
      "Сообщения и голос из подключённой темы поступают в чат BB.",
      "Text and voice from connected topics go to the BB chat.",
    ],
    [
      "richReplies",
      "Оформленные ответы",
      "Rich replies",
      "Rich Messages с форматированием; обычный текст при несовместимости.",
      "Rich Messages with formatting; plain text fallback.",
    ],
    [
      "notifyTasks",
      "События Tasks",
      "Tasks events",
      "Новые задачи, статусы, завершение и сроки.",
      "New tasks, statuses, completion and due dates.",
    ],
    [
      "notifyWorkerErrors",
      "Ошибки исполнителей Tasks",
      "Task worker errors",
      "Ошибки агентов, прикреплённых к задачам.",
      "Errors from agents attached to tasks.",
    ],
    [
      "soundOnReview",
      "Звук при проверке и ошибках",
      "Sound for reviews and errors",
      "Остальные уведомления приходят без звука.",
      "Other notifications arrive silently.",
    ],
    [
      "deleteTopics",
      "Удалять темы удалённых проектов",
      "Delete topics of deleted projects",
      "Удаляется и история темы Telegram. Отключи, чтобы сохранять её.",
      "Also deletes the Telegram topic history. Turn off to preserve it.",
    ],
  ];
  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Telegram · BB</h1>
        <p className="text-muted-foreground mt-2">
          {t(
            "Подключение бота, чаты проектов и уведомления.",
            "Bot connection, project chats and notifications.",
          )}
        </p>
      </header>
      {notice && (
        <p role="status" className="border rounded-md p-3">
          {notice}
        </p>
      )}
      {!form ? (
        <button className={button} onClick={() => void load()}>
          Повторить / Retry
        </button>
      ) : (
        <>
          <fieldset disabled={busy} className="border rounded-xl p-5 space-y-4">
            <legend className="px-2 font-semibold">
              {t("Подключение", "Connection")}
            </legend>
            <p>
              {t("Личный бот", "Personal bot")}: @{data?.bot ?? "aivech_bot"} ·{" "}
              {present
                ? t("токен сохранён", "token saved")
                : t("токен не настроен", "token not configured")}
            </p>
            <label className="block">
              Bot token{" "}
              <input
                className={input + " block w-full mt-2"}
                type="password"
                autoComplete="new-password"
                value={token}
                placeholder={t(
                  "Вставь токен из BotFather для проверки или замены",
                  "Paste a BotFather token to check or replace",
                )}
                onChange={(e) => {
                  setToken(e.target.value);
                  setCheck(null);
                }}
              />
            </label>
            <p className="text-sm text-muted-foreground">
              {t(
                "Токен хранится на сервере и не возвращается в интерфейс. Замена доступна для текущего бота; другой бот требует отдельного переноса привязок.",
                "The token stays on the server and is never returned to this page. Replacement supports the current bot; another bot requires a separate binding migration.",
              )}
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                className={button}
                onClick={() =>
                  void action(async () =>
                    setCheck(
                      await rpc.call("checkConnection", {
                        ...(token.trim() ? { token: token.trim() } : {}),
                      }),
                    ),
                  )
                }
              >
                {t("Проверить подключение", "Check connection")}
              </button>
              <button
                className={button}
                disabled={!token.trim()}
                onClick={() =>
                  void action(async () => {
                    const d = await rpc.call("saveToken", {
                      token: token.trim(),
                    });
                    setCheck(d);
                    if (d.valid && d.sameBot && !d.error && !d.webhook) {
                      setToken("");
                      setPresent(true);
                      setNotice(
                        t(
                          "Токен сохранён. Приёмник переподключится автоматически.",
                          "Token saved. The receiver reconnects automatically.",
                        ),
                      );
                    } else
                      setNotice(
                        t(
                          "Токен не сохранён. Исправь ошибки ниже.",
                          "Token not saved. Resolve the issues below.",
                        ),
                      );
                  })
                }
              >
                {t("Проверить и сохранить токен", "Check and save token")}
              </button>
            </div>
            {check && (
              <div
                className="border rounded-md p-4 space-y-2"
                aria-live="polite"
              >
                <p>
                  {check.valid ? "✅" : "❌"} {t("Токен", "Token")}
                  {check.username ? " · @" + check.username : ""}
                </p>
                {check.valid && (
                  <>
                    <p>
                      {check.sameBot ? "✅" : "❌"}{" "}
                      {t(
                        "Совпадает с подключённым ботом",
                        "Matches the connected bot",
                      )}
                    </p>
                    <p>
                      {check.topics ? "✅" : "❌"} Threaded Mode —{" "}
                      {check.topics
                        ? t("включён", "enabled")
                        : t(
                            "включи в BotFather → Bot Settings → Threads Settings",
                            "enable in BotFather → Bot Settings → Threads Settings",
                          )}
                    </p>
                    <p>
                      {check.userTopics ? "✅" : "⚠️"}{" "}
                      {t("Создание тем пользователем", "User-created topics")} —{" "}
                      {!check.userTopics
                        ? t(
                            "отключи Disallow users to create new threads, чтобы создавать темы вручную",
                            "turn off Disallow users to create new threads to create topics manually",
                          )
                        : t("разрешено", "allowed")}
                    </p>
                    <p>
                      {check.error ? "⚠️" : check.webhook ? "❌" : "✅"}{" "}
                      {check.error
                        ? t(
                            "Webhook: проверка не завершена",
                            "Webhook: check incomplete",
                          )
                        : check.webhook
                          ? t(
                              "Установлен webhook. Приёмник использует polling: сначала отключи webhook в прежней интеграции.",
                              "A webhook is configured. This receiver uses polling: disable the webhook in the previous integration first.",
                            )
                          : t(
                              "Webhook не мешает приёму сообщений",
                              "No webhook conflicts with message polling",
                            )}
                    </p>
                  </>
                )}
                {check.error && (
                  <p>
                    {t(
                      "Проверка не завершена: проверь токен и доступ сервера к Telegram.",
                      "Check incomplete: verify the token and server access to Telegram.",
                    )}
                  </p>
                )}
              </div>
            )}
            <details>
              <summary className="cursor-pointer">
                {t("Что включить в BotFather", "What to enable in BotFather")}
              </summary>
              <div className="mt-3 space-y-2 text-sm">
                <p>
                  <b>Threaded Mode: ON.</b>{" "}
                  {t(
                    "Обязательно для тем проектов.",
                    "Required for project topics.",
                  )}
                </p>
                <p>
                  <b>Disallow users to create new threads: OFF.</b>{" "}
                  {t(
                    "Для новых тем вручную и команды /project.",
                    "For manually created topics and /project.",
                  )}
                </p>
                <p>
                  <b>Restrict bot usage.</b>{" "}
                  {t(
                    "Можно включить для личного доступа. API не раскрывает эту настройку; проверь вручную.",
                    "Optional for personal access. The API does not expose this setting; check it manually.",
                  )}
                </p>
                <p>
                  {t(
                    "Bot Management, Bot-to-Bot, Guest, Guard, Secretary и права групп не нужны для личных чатов с BB. Для общения агентов внутри BB режим Bot-to-Bot не требуется.",
                    "Bot Management, Bot-to-Bot, Guest, Guard, Secretary and group permissions are unnecessary for private BB chats. Agents communicating inside BB do not require Bot-to-Bot mode.",
                  )}
                </p>
                <p>
                  {t(
                    "Открой личный чат с ботом и нажми Start.",
                    "Open the bot’s private chat and press Start.",
                  )}
                </p>
                <a
                  className="underline"
                  href="https://core.telegram.org/bots/api#user"
                  target="_blank"
                  rel="noreferrer"
                >
                  Telegram Bot API ↗
                </a>
              </div>
            </details>
          </fieldset>
          <fieldset disabled={busy} className="border rounded-xl p-5 space-y-5">
            <legend className="px-2 font-semibold">
              {t("Поведение и язык", "Behavior and language")}
            </legend>
            <label className="flex items-center justify-between gap-3">
              {t("Язык интерфейса и бота", "Interface and bot language")}
              <select
                className={input}
                value={form.language}
                onChange={(e) =>
                  setForm({ ...form, language: e.target.value as "ru" | "en" })
                }
              >
                <option value="ru">Русский</option>
                <option value="en">English</option>
              </select>
            </label>
            <p className="text-sm text-muted-foreground">
              {t(
                "Язык новых меню и служебных сообщений. Существующая история и ответы агентов не переводятся.",
                "Language of new menus and service messages. Existing history and agent replies are not translated.",
              )}
            </p>
            {flags.map(([key, ru, eng, hru, hen]) => (
              <label key={key} className="flex gap-3 items-start">
                <input
                  className="mt-1"
                  type="checkbox"
                  checked={Boolean(form[key])}
                  onChange={(e) =>
                    setForm({ ...form, [key]: e.target.checked })
                  }
                />
                <span>
                  <span className="block font-medium">{t(ru, eng)}</span>
                  <span className="text-sm text-muted-foreground">
                    {t(hru, hen)}
                  </span>
                </span>
              </label>
            ))}
            <label className="block">
              {t("Публичный адрес BB", "Public BB URL")}
              <input
                type="url"
                className={input + " block w-full mt-2"}
                value={form.appUrl}
                onChange={(e) => setForm({ ...form, appUrl: e.target.value })}
              />
            </label>
            <button
              className={button}
              onClick={() =>
                void action(async () => {
                  const { tokenPresent: _, ...prefs } = form as Preferences & {
                    tokenPresent?: boolean;
                  };
                  try {
                    if (new URL(prefs.appUrl).protocol !== "https:") throw 0;
                  } catch {
                    setNotice(
                      t(
                        "Укажи полный адрес BB с https://",
                        "Enter the full BB URL starting with https://",
                      ),
                    );
                    return;
                  }
                  await rpc.call("savePreferences", prefs);
                  setNotice(
                    t(
                      "Настройки сохранены. Новые сообщения используют выбранный язык.",
                      "Settings saved. New messages use the selected language.",
                    ),
                  );
                })
              }
            >
              {t("Сохранить настройки", "Save settings")}
            </button>
          </fieldset>
          <section className="border rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">{t("Состояние", "Status")}</h2>
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void action(async () => setData(await rpc.call("sync", null)))
                }
              >
                {t("Синхронизировать", "Sync now")}
              </button>
            </div>
            {data && (
              <>
                <p>
                  {t("Темы", "Topics")}: {data.topics.length} ·{" "}
                  {t("Очередь", "Queue")}: {data.queue + data.chatQueue} ·
                  Tasks: {data.tasks}
                </p>
                {(data.error || data.chatError) && (
                  <p role="alert">{data.error || data.chatError}</p>
                )}
                <p className="text-sm">
                  /project · /chats · /new · /model · /section · /stop · /menu
                </p>
                <ul className="space-y-2">
                  {data.topics.map((v: any) => (
                    <li key={v.key}>
                      {v.threadId ? "✅" : "⏳"} {v.name}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "telegram-projects",
    title: "Telegram",
    icon: "MessageCircle",
    path: "telegram-projects",
    component: Panel,
  });
});
