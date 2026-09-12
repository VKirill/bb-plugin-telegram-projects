import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { writeFileSync, renameSync } from "node:fs";
import {
  telegram,
  checkBot,
  runBb,
  trackersSchema,
  readTasks,
} from "./adapters";
import {
  OWNER_ID,
  BOT_ID,
  ensureTopic,
  reconcileProjects,
  ingest,
  escapeHtml,
  formatEvent,
  TelegramFailure,
  type Store,
  type Topic,
  type Event,
  type Task,
  type Tracker,
} from "./model";
const statusSchema = z.object({
  enabled: z.boolean(),
  bot: z.string(),
  topicsEnabled: z.boolean(),
  lastSync: z.string().nullable(),
  error: z.string().nullable(),
  queue: z.number(),
  topics: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      threadId: z.number().nullable(),
      creating: z.boolean(),
    }),
  ),
  tasks: z.number(),
});
export const rpcContract = defineRpcContract({
  status: { input: z.null(), output: statusSchema },
  sync: { input: z.null(), output: statusSchema },
});
export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Синхронизация с Telegram",
      default: false,
    },
    configFile: {
      type: "string",
      label: "Закрытый файл бота на сервере BB",
      default: "/Users/vechkasov/toolkit/service-bots/private/aivech.json",
    },
    projectionFile: {
      type: "string",
      label: "Файл состояния для сервисного бота на сервере",
      default:
        "/Users/vechkasov/toolkit/service-bots/private/telegram-projects.json",
    },
    cliPath: {
      type: "string",
      label: "BB CLI на сервере",
      default: process.env.BB_CLI || "bb",
    },
    appUrl: {
      type: "string",
      label: "Публичный адрес BB",
      default: bb.server.experimental_appUrl || "https://vechkasov.getbb.app",
    },
    deleteTopics: {
      type: "boolean",
      label: "Удалять тему и её историю при удалении проекта BB",
      default: true,
    },
    notifyTasks: { type: "boolean", label: "Уведомления Tasks", default: true },
    notifyWorkerErrors: {
      type: "boolean",
      label: "Ошибки исполнителей, прикреплённых в Tasks",
      default: true,
    },
    soundOnReview: {
      type: "boolean",
      label: "Звук при проверке и ошибках",
      default: true,
    },
  });
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    "CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  ]);
  const store: Store = {
    get<T>(key: string) {
      const r = db.prepare("SELECT value FROM state WHERE key=?").get(key) as
        { value: string } | undefined;
      return r ? (JSON.parse(r.value) as T) : undefined;
    },
    put(key, value) {
      db.prepare(
        "INSERT INTO state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(key, JSON.stringify(value));
    },
    del(key) {
      db.prepare("DELETE FROM state WHERE key=?").run(key);
    },
    list<T>(prefix: string) {
      return (
        db
          .prepare(
            "SELECT key,value FROM state WHERE substr(key,1,?)=? ORDER BY key",
          )
          .all(prefix.length, prefix) as { key: string; value: string }[]
      ).map((r) => ({ key: r.key, value: JSON.parse(r.value) as T }));
    },
    atomic(fn) {
      db.transaction(fn)();
    },
  };
  const lifetime = new AbortController();
  let flight: Promise<void> | null = null;
  let lastError: string | null = null;
  let topicsEnabled = false;
  let username = "aivech_bot";
  let lastSync: string | null = null;
  let wake: (() => void) | undefined;
  const safeError = (e: unknown) =>
    e instanceof TelegramFailure
      ? e.code
      : e instanceof Error && /^[a-z_]+(?::[a-zA-Z0-9_]+)?$/.test(e.message)
        ? e.message
        : "sync_failed";
  async function status() {
    const cfg = await settings.get();
    return {
      enabled: cfg.enabled,
      bot: username,
      topicsEnabled,
      lastSync,
      error: lastError,
      queue: store.list("queue:").length,
      topics: store
        .list<Topic>("topic:")
        .map((x) => ({
          key: x.value.key,
          name: x.value.name,
          threadId: x.value.threadId,
          creating: x.value.creating,
        })),
      tasks: store.list("task:").length,
    };
  }
  async function run() {
    const cfg = await settings.get();
    if (!cfg.enabled) return;
    if ((store.get<number>("retryAt") ?? 0) > Date.now()) return;
    if (!store.get("trackingSince")) store.put("trackingSince", Date.now());
    const tg = telegram(cfg.configFile, lifetime.signal);
    const me = await checkBot(tg);
    username = me.username;
    topicsEnabled = me.topics;
    // A complete project snapshot is the only authority for removals. Failed reads never reconcile.
    const projects = (
      await bb.sdk.projects.list({ signal: lifetime.signal })
    ).filter((p) => p.kind === "standard");
    const cli = (args: string[]) =>
      runBb(cfg.cliPath, bb.server.loopbackBaseUrl, args, lifetime.signal);
    let taskFailure: string | null = null;
    const allTasks: { task: Task; tracker: Tracker }[] = [];
    if (cfg.notifyTasks) {
      try {
        const trackers = trackersSchema.parse(
          await cli(["tasks", "project", "list", "--json"]),
        ).projects;
        for (const tracker of trackers) {
          if (
            !tracker.linkedBbProjectId ||
            !projects.some((p) => p.id === tracker.linkedBbProjectId)
          )
            continue;
          const tasks = await readTasks(cli, tracker.id);
          ingest(store, tracker, tasks);
          allTasks.push(...tasks.map((task) => ({ task, tracker })));
          if (cfg.notifyWorkerErrors) {
            for (const task of tasks.filter(
              (t) => !["done", "canceled"].includes(t.status),
            )) {
              const result = z
                .object({
                  taskThreads: z.array(
                    z.object({
                      threadId: z.string(),
                      liveStatus: z.string().nullable(),
                      updatedAt: z.string(),
                    }),
                  ),
                })
                .parse(await cli(["tasks", "threads", task.id, "--json"]));
              for (const worker of result.taskThreads) {
                const key = "worker:" + worker.threadId;
                const prev = store.get<{ liveStatus: string | null }>(key);
                if (
                  (prev
                    ? prev.liveStatus !== worker.liveStatus
                    : Date.parse(worker.updatedAt) >=
                      (store.get<number>("trackingSince") ?? Infinity)) &&
                  worker.liveStatus === "error"
                ) {
                  const event: Event = {
                    id: `${task.id}:${worker.threadId}:${worker.updatedAt}:error`,
                    projectId: tracker.linkedBbProjectId,
                    taskId: task.id,
                    key: task.key,
                    title: task.title,
                    tracker: tracker.name,
                    status: task.status,
                    kind: "worker_error",
                    dueDate: task.dueDate,
                    at: new Date().toISOString(),
                    urgent: true,
                  };
                  if (!store.get("sent:" + event.id))
                    store.put("queue:" + event.id, event);
                }
                store.put(key, { liveStatus: worker.liveStatus });
              }
            }
          }
        }
      } catch (e) {
        taskFailure = safeError(e);
      }
    }
    if (!topicsEnabled) {
      lastError = "threaded_mode_disabled";
      await publishProjection(cfg.projectionFile, allTasks);
      return;
    }
    await ensureTopic(store, tg, "navigation", "🧭 Навигация");
    await ensureTopic(store, tg, "sms", "📱 SMS");
    await reconcileProjects(store, tg, projects, cfg.deleteTopics);
    const base = new URL(cfg.appUrl);
    if (base.protocol !== "https:")
      throw new Error("public_https_url_required");
    for (const { value: topic } of store.list<Topic>("topic:")) {
      if (!topic.threadId || topic.missingSince) continue;
      let text =
        topic.key === "navigation"
          ? "<b>🧭 Рабочее пространство Кирилла</b>\n\n" +
            projects.map((p) => "📂 " + escapeHtml(p.name)).join("\n") +
            "\n\nВ темах проектов — уведомления Tasks.\n📱 SMS — коды и сообщения на телефон.\n\n/projects — проекты\n/tasks — активные задачи\n/status — состояние сервисов"
          : topic.key === "sms"
            ? "<b>📱 SMS</b>\n\nЗдесь будут новые сообщения на телефон и кнопки копирования кодов."
            : `<b>${escapeHtml(topic.name)}</b>\n\nЗдесь появляются события задач этого проекта: создание, запуск, проверка, завершение, отмена и изменение срока.\nОбычные чаты не пересылаются.\n\n/tasks — активные задачи проекта`;
      if (topic.introText === text) continue;
      const payload = {
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: {
          inline_keyboard: [[{ text: "Открыть BB", url: base.origin }]],
        },
      };
      if (topic.introId)
        await tg("editMessageText", { message_id: topic.introId, ...payload });
      else {
        const sent = await tg("sendMessage", {
          message_thread_id: topic.threadId,
          disable_notification: true,
          ...payload,
        });
        topic.introId = sent.message_id;
      }
      topic.introText = text;
      store.put("topic:" + topic.key, topic);
    }
    for (const { key, value: e } of store
      .list<Event>("queue:")
      .filter(
        (x) =>
          x.value.kind === "test" ||
          (cfg.notifyTasks &&
            (x.value.kind !== "worker_error" || cfg.notifyWorkerErrors)),
      )
      .slice(0, 15)) {
      if (!projects.some((p) => p.id === e.projectId)) continue;
      const topic = store.get<Topic>("topic:" + e.projectId);
      if (!topic?.threadId) continue;
      // Tasks detail route verified through the live Tasks UI.
      await tg("sendMessage", {
        message_thread_id: topic.threadId,
        text: formatEvent(e),
        parse_mode: "HTML",
        disable_notification: !(cfg.soundOnReview && e.urgent),
        link_preview_options: { is_disabled: true },
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  e.kind === "test"
                    ? "Открыть Telegram Projects"
                    : `Открыть ${e.key}`,
                url:
                  base.origin +
                  (e.kind === "test"
                    ? "/plugins/telegram-projects/telegram-projects"
                    : "/plugins/tasks/tasks/task/" + encodeURIComponent(e.key)),
              },
            ],
          ],
        },
      });
      store.atomic(() => {
        store.put("sent:" + e.id, Date.now());
        store.del(key);
      });
    }
    // Keep dedupe receipts for a month. Task/worker snapshots contain metadata only.
    for (const { key, value: at } of store.list<number>("sent:"))
      if (at < Date.now() - 30 * 86400_000) store.del(key);
    lastSync = new Date().toISOString();
    lastError = taskFailure;
    await publishProjection(cfg.projectionFile, allTasks);
  }
  async function publishProjection(
    path: string,
    items: { task: Task; tracker: Tracker }[],
  ) {
    const data = {
      botId: BOT_ID,
      ownerId: OWNER_ID,
      updatedAt: Date.now(),
      topicsEnabled,
      error: lastError,
      topics: store
        .list<Topic>("topic:")
        .map((x) => x.value)
        .filter((x) => !x.missingSince),
      tasks: items
        .filter((x) => !["done", "canceled"].includes(x.task.status))
        .map(({ task, tracker }) => ({
          key: task.key,
          title: task.title,
          status: task.status,
          projectId: tracker.linkedBbProjectId,
          tracker: tracker.name,
        }))
        .slice(0, 500),
    };
    writeFileSync(path + ".tmp", JSON.stringify(data), { mode: 0o600 });
    renameSync(path + ".tmp", path);
  }
  async function sync() {
    if (flight) return flight;
    flight = run()
      .catch((e) => {
        lastError = safeError(e);
        if (e instanceof TelegramFailure)
          store.put("retryAt", Date.now() + e.retryAfter * 1000);
        bb.log.warn("Telegram Projects: " + lastError);
      })
      .finally(() => {
        flight = null;
      });
    return flight;
  }
  bb.rpc.register(rpcContract, {
    status: () => status(),
    sync: async () => {
      await sync();
      return status();
    },
  });
  bb.cli.register({
    name: "telegram-projects",
    summary: "Синхронизация проектов и Tasks с темами Telegram",
    commands: [
      {
        name: "test",
        summary: "Отправить явно отмеченную проверку в тему проекта",
        usage: "bb telegram-projects test <project-id>",
      },
      {
        name: "status",
        summary: "Состояние и темы",
        usage: "bb telegram-projects status --json",
      },
      {
        name: "sync",
        summary: "Синхронизировать сейчас",
        usage: "bb telegram-projects sync --json",
      },
      {
        name: "bind",
        summary:
          "Привязать существующую тему после неопределённого ответа Telegram",
        usage:
          "bb telegram-projects bind <project-id|sms|navigation> <topic-id>",
      },
    ],
    async run(argv) {
      const [cmd, key, id] = argv.filter((x) => x !== "--json");
      if (cmd === "test") {
        if (flight) await flight;
        const cfg = await settings.get();
        if (
          !cfg.enabled ||
          !key ||
          !key.startsWith("proj_") ||
          !store.get<Topic>("topic:" + key)?.threadId
        )
          return { exitCode: 1, stderr: "project_topic_required" };
        const event: Event = {
          id: "test:" + Date.now(),
          projectId: key,
          taskId: "demo",
          key: "TEST",
          title:
            "Уведомления Tasks будут приходить в тему своего проекта. Это проверка доставки, не настоящая задача.",
          tracker: "Проверка настройки",
          status: "todo",
          kind: "test",
          dueDate: null,
          at: new Date().toISOString(),
          urgent: false,
        };
        store.put("queue:" + event.id, event);
        await sync();
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            queued: !!store.get("queue:" + event.id),
            error: lastError,
          }),
        };
      }
      if (cmd === "bind") {
        if (flight) return { exitCode: 1, stderr: "sync_busy" };
        const topic = key ? store.get<Topic>("topic:" + key) : undefined;
        const threadId = Number(id);
        if (!topic || !Number.isSafeInteger(threadId) || threadId <= 0)
          return { exitCode: 1, stderr: "invalid_binding" };
        if (
          store
            .list<Topic>("topic:")
            .some((x) => x.value.key !== key && x.value.threadId === threadId)
        )
          return { exitCode: 1, stderr: "topic_already_bound" };
        const cfg = await settings.get();
        const tg = telegram(cfg.configFile, lifetime.signal);
        await checkBot(tg);
        await tg("editForumTopic", {
          message_thread_id: threadId,
          name: topic.name,
        });
        store.put("topic:" + key, {
          ...topic,
          threadId,
          creating: false,
          introId: undefined,
          introText: undefined,
        });
        return { exitCode: 0, stdout: "Bound" };
      }
      if (cmd === "sync") await sync();
      else if (cmd !== "status")
        return { exitCode: 1, stderr: "Use status, sync or bind" };
      return { exitCode: 0, stdout: JSON.stringify(await status(), null, 2) };
    },
  });
  settings.onChange(() => {
    wake?.();
  });
  bb.background.service("project-task-sync", {
    async start(signal) {
      signal.addEventListener("abort", () => lifetime.abort(), { once: true });
      const unsubscribe = bb.sdk.subscribe({
        event: "project:changed",
        callback: () => wake?.(),
      });
      try {
        while (!signal.aborted) {
          await sync();
          await new Promise<void>((resolve) => {
            const timer = setTimeout(done, 15_000);
            function done() {
              clearTimeout(timer);
              signal.removeEventListener("abort", done);
              wake = undefined;
              resolve();
            }
            wake = done;
            signal.addEventListener("abort", done, { once: true });
            if (signal.aborted) done();
          });
        }
      } finally {
        unsubscribe();
      }
    },
  });
  bb.onDispose(async () => {
    lifetime.abort();
    wake?.();
    await flight;
  });
}
