import { agencyIntegration, agencyDeliverySchema, agencyCapabilitySchema, agencyReceiptSchema } from "./agency-integration";
import { translate } from "./companion/aivech/src/locale";
import {
  preferencesSchema,
  diagnosisSchema,
  savedToken,
  diagnose,
  persistToken,
} from "./settings";
import { ChatBridge } from "./chat";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  watch,
  writeFileSync,
  renameSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import {
  telegram,
  transcribeTelegramVoice,
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
  chatEnabled: z.boolean(),
  chatBindings: z.array(
    z.object({
      topicId: z.number(),
      projectId: z.string(),
      threadId: z.string().nullable(),
      ready: z.boolean(),
    }),
  ),
  chatQueue: z.number(),
  chatError: z.string().nullable(),
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
  agencyCapabilities: {input:z.null(),output:agencyCapabilitySchema},
  agencyConfigure: {input:z.object({enabled:z.boolean()}).strict(),output:z.object({saved:z.literal(true)})},
  agencyEnqueue: {input:agencyDeliverySchema,output:agencyReceiptSchema},
  agencyDeliveryStatus: {input:z.object({deliveryId:z.string().min(1).max(160)}).strict(),output:agencyReceiptSchema},
  preferences: {
    input: z.null(),
    output: preferencesSchema.extend({ tokenPresent: z.boolean() }),
  },
  savePreferences: { input: preferencesSchema, output: z.boolean() },
  checkConnection: {
    input: z.object({ token: z.string().max(200).optional() }),
    output: diagnosisSchema,
  },
  saveToken: {
    input: z.object({ token: z.string().max(200) }),
    output: diagnosisSchema,
  },
  status: { input: z.null(), output: statusSchema },
  sync: { input: z.null(), output: statusSchema },
});
export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    agencyEnabled: {type:"boolean",label:"Уведомления из Агентства",default:false},
    language: {
      type: "select",
      label: "Language / Язык",
      options: ["ru", "en"],
      default: "ru",
    },
    enabled: {
      type: "boolean",
      label: "Синхронизация с Telegram",
      default: false,
    },
    chatEnabled: {
      type: "boolean",
      label: "Общение с BB из Telegram",
      default: false,
    },
    richReplies: {
      type: "boolean",
      label: "Rich Messages для ответов BB",
      default: true,
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
  let bridge: ChatBridge | undefined;
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
      chatEnabled: cfg.chatEnabled,
      chatBindings: bridge?.status().bindings ?? [],
      chatQueue: bridge?.status().outgoing ?? 0,
      chatError: bridge?.status().lastError ?? null,
      enabled: cfg.enabled,
      bot: username,
      topicsEnabled,
      lastSync,
      error: lastError,
      queue: store.list("queue:").length,
      topics: store.list<Topic>("topic:").map((x) => ({
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
    const tr = (s: string) => translate(cfg.language as "ru" | "en", s);
    if (!cfg.enabled) return;
    if ((store.get<number>("retryAt") ?? 0) > Date.now()) return;
    if (!store.get("trackingSince")) store.put("trackingSince", Date.now());
    const tg = telegram(cfg.configFile, lifetime.signal);
    const me = await checkBot(tg);
    if (store.get("commandsLanguage") !== cfg.language + ":v2") {
      const labels =
        cfg.language === "en"
          ? [
              "Bind this topic to a project",
              "Chat menu",
              "New chat",
              "Find and connect chats",
              "Agent and model",
              "Choose a section",
              "Last reply",
              "Stop the run",
              "Disconnect this chat",
              "Active tasks",
              "Service status",
              "Help",
              "Choose a server",
              "Choose an agent profile",
            ]
          : [
              "Привязать тему к проекту",
              "Меню чата",
              "Новый чат",
              "Найти и подключить чат",
              "Агент и модель",
              "Выбрать раздел",
              "Последний ответ",
              "Остановить запуск",
              "Отключить чат",
              "Активные задачи",
              "Состояние сервисов",
              "Помощь",
              "Выбрать сервер",
              "Выбрать профиль агента",
            ];
      const commands = [
        "project",
        "menu",
        "new",
        "chats",
        "model",
        "section",
        "history",
        "stop",
        "disconnect",
        "tasks",
        "status",
        "help",
        "server",
        "profile",
      ].map((command, i) => ({ command, description: labels[i] }));
      for (const language_code of ["", "ru", "en"])
        await tg("setMyCommands", {
          commands,
          scope: { type: "chat", chat_id: OWNER_ID },
          language_code,
        });
      store.put("commandsLanguage", cfg.language + ":v2");
    }
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
    await ensureTopic(store, tg, "navigation", tr("🧭 Навигация"));
    await ensureTopic(store, tg, "sms", "📱 SMS");
    await reconcileProjects(store, tg, projects, cfg.deleteTopics);
    const base = new URL(cfg.appUrl);
    if (base.protocol !== "https:")
      throw new Error("public_https_url_required");
    for (const { value: topic } of store.list<Topic>("topic:")) {
      if (!topic.threadId || topic.missingSince) continue;
      let text =
        topic.key === "navigation"
          ? tr("<b>🧭 Рабочее пространство Кирилла</b>\n\n") +
            projects.map((p) => "📂 " + escapeHtml(p.name)).join("\n") +
            tr(
              "\n\nВ темах проектов — чаты BB и уведомления Tasks.\n📱 SMS — коды и сообщения на телефон.\n\n/project — привязать новую тему\n/chats — чаты BB\n/model — агент и модель\n/tasks — активные задачи\n/menu — управление",
            )
          : topic.key === "sms"
            ? tr(
                "<b>📱 SMS</b>\n\nЗдесь будут новые сообщения на телефон и кнопки копирования кодов.",
              )
            : "<b>" +
              String(escapeHtml(topic.name)) +
              tr(
                "</b>\n\nЗдесь появляются события задач этого проекта.\n\n/menu — управление чатом BB\n/new — новая сессия\n/chats — подключиться к существующему чату\n/model — агент и модель\n/tasks — задачи проекта\n\nВ Telegram приходят только ответы подключённого чата и события Tasks.",
              );
      if (topic.introText === text) continue;
      const payload = {
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: {
          inline_keyboard: [[{ text: tr("Открыть BB"), url: base.origin }]],
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
          (x.value.kind.startsWith("agency_") ? cfg.agencyEnabled : x.value.kind === "test" ||
          (cfg.notifyTasks &&
            (x.value.kind !== "worker_error" || cfg.notifyWorkerErrors))),
      )
      .slice(0, 15)) {
      if (!projects.some((p) => p.id === e.projectId)) continue;
      const topic = store.get<Topic>("topic:" + e.projectId);
      if (!topic?.threadId) continue;
      if(e.kind.startsWith("agency_") && e.agencyTopicId!==topic.threadId) continue;
      // Keep deliveries bound to their original topic.
      // Tasks detail route verified through the live Tasks UI.
      await tg("sendMessage", {
        message_thread_id: topic.threadId,
        text: formatEvent(e, cfg.language as "ru" | "en"),
        parse_mode: "HTML",
        disable_notification: !(cfg.soundOnReview && e.urgent),
        link_preview_options: { is_disabled: true },
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  e.kind === "test"
                    ? tr("Открыть Telegram Projects")
                    : tr("Открыть ") + String(e.key) + "",
                url:
                  base.origin +
                  (e.kind === "test"
                    ? "/plugins/telegram-projects/telegram-projects"
                    : e.kind.startsWith("agency_") ? "/plugins/agency/overview/jobs/" + encodeURIComponent(e.key) : "/plugins/tasks/tasks/task/" + encodeURIComponent(e.key)),
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
      chatBindings:
        bridge
          ?.bindings()
          .map((b) => ({ topicId: b.topicId, projectId: b.projectId })) ?? [],
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
  const agency=agencyIntegration(store);
  bb.rpc.register(rpcContract, {
    agencyCapabilities: async()=>{const c=await settings.get();return agency.capabilities(c.enabled&&c.agencyEnabled);},
    agencyConfigure: async({enabled})=>{await settings.experimental_set({agencyEnabled:enabled});return {saved:true as const};},
    agencyEnqueue: async(input)=>{const c=await settings.get();return agency.enqueue(input,c.enabled&&c.agencyEnabled);},
    agencyDeliveryStatus: ({deliveryId})=>agency.status(deliveryId),
    preferences: async () => {
      const c = await settings.get();
      return {
        ...(Object.fromEntries(
          Object.keys(preferencesSchema.shape).map((k) => [
            k,
            c[k as keyof typeof c],
          ]),
        ) as z.infer<typeof preferencesSchema>),
        tokenPresent: Boolean(savedToken(c.configFile)),
      };
    },
    savePreferences: async (value) => {
      await settings.experimental_set(value);
      return true;
    },
    checkConnection: async ({ token }) => {
      const c = await settings.get();
      return diagnose(token?.trim() || savedToken(c.configFile));
    },
    saveToken: async ({ token }) => {
      const c = await settings.get();
      const clean = token.trim();
      const result = await diagnose(clean);
      if (result.valid && result.sameBot && !result.error && !result.webhook) {
        persistToken(c.configFile, clean);
      }
      return result;
    },
    status: () => status(),
    sync: async () => {
      await sync();
      return status();
    },
  });
  bb.cli.register({
    name: "telegram-projects",
    summary: "Проекты, чаты BB и уведомления Tasks в Telegram",
    commands: [
      {
        name: "chat-forget",
        summary: "Удалить только привязку темы, сохранив чаты",
        usage: "bb telegram-projects chat-forget <topic-id>",
      },
      {
        name: "chat-status",
        summary: "Состояние общения с BB",
        usage: "bb telegram-projects chat-status --json",
      },
      {
        name: "menu",
        summary: "Показать меню чата в теме проекта",
        usage: "bb telegram-projects menu <project-id>",
      },
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
      if (cmd === "chat-forget") {
        const topicId = Number(key);
        if (!bridge || !Number.isSafeInteger(topicId) || topicId < 0)
          return { exitCode: 1, stderr: "invalid_topic" };
        bridge.forget(topicId);
        return {
          exitCode: 0,
          stdout: "Binding removed; BB and Telegram history preserved",
        };
      }
      if (cmd === "chat-status")
        return {
          exitCode: 0,
          stdout: JSON.stringify(bridge?.status() ?? { started: false }),
        };
      if (cmd === "menu") {
        const topic = key ? store.get<Topic>("topic:" + key) : undefined;
        if (!bridge || !topic?.threadId)
          return { exitCode: 1, stderr: "chat_topic_required" };
        await bridge.handle({
          updateId: Date.now(),
          ownerId: OWNER_ID,
          chatId: OWNER_ID,
          topicId: topic.threadId,
          messageId: 0,
          text: "/menu",
        });
        return { exitCode: 0, stdout: "Menu queued" };
      }
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
  bb.background.service("telegram-chat", {
    async start(signal) {
      const spool =
        "/Users/vechkasov/toolkit/service-bots/private/bb-chat-inbox";
      const control =
        "/Users/vechkasov/toolkit/service-bots/private/telegram-chat.json";
      let rich = true;
      let currentUrl = "";
      let language: "ru" | "en" = "ru";
      let activeAbort: AbortController | undefined;
      let pendingWake = false;
      let resume: (() => void) | undefined;
      const wakeChat = () => {
        pendingWake = true;
        resume?.();
      };
      mkdirSync(spool, { recursive: true, mode: 0o700 });
      const watcher = watch(spool, (_event, name) => {
        if (name?.toString().endsWith(".json")) wakeChat();
      });
      watcher.on("error", () => {}); // Timed polling remains as recovery if filesystem events are lost.
      try {
        while (!signal.aborted) {
          const cfg = await settings.get();
          if (cfg.enabled && cfg.chatEnabled) {
            rich = cfg.richReplies;
            currentUrl = new URL(cfg.appUrl).origin;
            language = cfg.language as "ru" | "en";
            if (!bridge) {
              mkdirSync(spool, { recursive: true, mode: 0o700 });
              activeAbort = new AbortController();
              const bridgeSignal = AbortSignal.any([
                signal,
                activeAbort.signal,
                lifetime.signal,
              ]);
              bridge = new ChatBridge({
                store,
                sdk: bb.sdk,
                tg: telegram(cfg.configFile, bridgeSignal),
                spool,
                get baseUrl() {
                  return currentUrl;
                },
                signal: bridgeSignal,
                rich: () => rich,
                language: () => language,
                wake: wakeChat,
                transcribe: (v) =>
                  transcribeTelegramVoice(
                    cfg.configFile,
                    bb.sdk,
                    v,
                    bridgeSignal,
                  ),
              });
              bridge.recover();
            }
            writeFileSync(
              control + ".tmp",
              JSON.stringify({
                enabled: true,
                language: cfg.language,
                updatedAt: Date.now(),
              }),
              { mode: 0o600 },
            );
            renameSync(control + ".tmp", control);
            await bridge.tick();
          } else {
            activeAbort?.abort();
            await bridge?.dispose();
            bridge = undefined;
            if (existsSync(control))
              writeFileSync(
                control,
                JSON.stringify({
                  enabled: false,
                  language: cfg.language,
                  updatedAt: Date.now(),
                }),
                { mode: 0o600 },
              );
          }
          await new Promise<void>((resolve) => {
            if (pendingWake) {
              pendingWake = false;
              resolve();
              return;
            }
            resume = done;
            const timer = setTimeout(done, 2000);
            function done() {
              clearTimeout(timer);
              resume = undefined;
              pendingWake = false;
              signal.removeEventListener("abort", done);
              resolve();
            }
            signal.addEventListener("abort", done, { once: true });
            if (signal.aborted) done();
          });
        }
      } finally {
        watcher.close();
        await bridge?.dispose();
      }
    },
  });
  bb.onDispose(async () => {
    lifetime.abort();
    wake?.();
    await flight;
    await bridge?.dispose();
  });
}
