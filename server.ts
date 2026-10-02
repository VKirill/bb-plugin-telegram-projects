import { agencyIntegration, agencyDeliverySchema, agencyCapabilitySchema, agencyReceiptSchema } from "./agency-integration";
import { translate } from "./companion/aivech/src/locale";
import {
  preferencesSchema,
  diagnosisSchema,
  diagnose,
} from "./settings";
import { ChatBridge } from "./chat";
import { routeUpdate, writeSpool } from "./ingress";
import { menuCommands } from "./commands";
import {
  classifyThread,
  eventKind,
  eventsSchema,
  formatThreadCard,
  formatThreadRich,
  summaryPrompt,
  readEvents,
  route,
  sectionFor,
  taskKindsOn,
  type Events,
} from "./events";
import { makeChatControlPublisher, writeJsonAtomic } from "./json-file";
import { mkdir } from "node:fs/promises";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  watch,
  mkdirSync,
  existsSync,
} from "node:fs";
import {
  telegram,
  transcribeTelegramVoice,
  checkBot,
  runBb,
  readEnvToken,
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
  ingressError: z.string().nullable(),
  menu: z.array(z.object({ command: z.string(), description: z.string() })),
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
    output: preferencesSchema.extend({
      tokenPresent: z.boolean(),
      tokenSource: z.enum(["manual", "env", "none"]),
      tokenEnv: z.string(),
    }),
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
  useEnvToken: { input: z.null(), output: z.boolean() },
  summaryDefaults: {
    input: z.null(),
    output: z.object({
      providerId: z.string(),
      model: z.string(),
      reasoningLevel: z.string(),
    }),
  },
  syncMenu: { input: z.null(), output: statusSchema },
  eventsGet: {
    input: z.null(),
    output: z.object({
      events: eventsSchema,
      projects: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          hidden: z.boolean(),
          topicId: z.number().nullable(),
        }),
      ),
    }),
  },
  eventsSave: { input: eventsSchema, output: z.boolean() },
  initTopics: { input: z.null(), output: statusSchema },
  status: { input: z.null(), output: statusSchema },
  sync: { input: z.null(), output: statusSchema },
});
const SPOOL = "/Users/vechkasov/toolkit/service-bots/private/bb-chat-inbox";
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
    botToken: {
      type: "string",
      label: "Токен бота, заданный вручную",
      secret: true,
    },
    tokenEnv: {
      type: "string",
      label: "Имя токена бота в Env Catalog",
      default: "TG_AIVECH_BOT",
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
    reportMode: {
      type: "select",
      label: "Что присылать в отчёте агента: полный ответ или саммери",
      options: ["full", "summary"],
      default: "full",
    },
    summaryProvider: {
      type: "string",
      label: "Провайдер для саммери (пусто — по умолчанию BB)",
      default: "",
    },
    summaryModel: {
      type: "string",
      label: "Модель для саммери (пусто — по умолчанию провайдера)",
      default: "",
    },
    summaryReasoning: {
      type: "string",
      label: "Уровень рассуждения для саммери",
      default: "",
    },
    summaryServiceTier: {
      type: "string",
      label: "Тариф для саммери (fast или default)",
      default: "",
    },
    hideWithFolders: {
      type: "boolean",
      label: "Скрывать темы проектов, скрытых в Project Folders",
      default: true,
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
  let ingressError: string | null = null;
  let activeTasks: { task: Task; tracker: Tracker }[] = [];
  let envToken = { name: "", value: "", at: 0 };
  // A manually saved token wins; otherwise the shared Env Catalog entry, re-read every 5 minutes.
  async function tokenSource(): Promise<"manual" | "env" | "none"> {
    const c = await settings.get();
    if (c.botToken?.trim()) return "manual";
    if (envToken.name !== c.tokenEnv || Date.now() - envToken.at > 300_000)
      envToken = {
        name: c.tokenEnv,
        value: await readEnvToken(
          c.cliPath,
          bb.server.loopbackBaseUrl,
          c.tokenEnv,
          lifetime.signal,
        ),
        at: Date.now(),
      };
    return envToken.value ? "env" : "none";
  }
  async function events(): Promise<Events> {
    const saved = store.get("events:config");
    if (saved) return readEvents(saved);
    const seeded = readEvents(null, await settings.get());
    store.put("events:config", seeded);
    return seeded;
  }
  const folderSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    path: z.string(),
  });
  type Folder = z.infer<typeof folderSchema>;
  // Project Folders is optional. A failed read keeps the last known state, never "nothing hidden".
  async function folderState(): Promise<{ hidden: string[]; folders: Folder[] }> {
    try {
      const [prefs, list] = await Promise.all([
        bb.sdk.plugins.callRpc({
          pluginId: "project-folders",
          method: "prefs_get",
          input: null,
          outputSchema: z.object({
            items: z.record(z.string(), z.object({ hidden: z.boolean().optional() }).passthrough()),
          }).passthrough(),
        }),
        bb.sdk.plugins.callRpc({
          pluginId: "project-folders",
          method: "list",
          input: null,
          outputSchema: z.object({ folders: z.array(folderSchema.passthrough()) }).passthrough(),
        }),
      ]);
      const state = {
        hidden: Object.entries(prefs.items)
          .filter(([, v]) => v.hidden)
          .map(([k]) => k),
        folders: list.folders.map(({ id, projectId, name, path }) => ({ id, projectId, name, path })),
      };
      store.put("folders:state", state);
      return state;
    } catch {
      return store.get("folders:state") ?? { hidden: [], folders: [] };
    }
  }
  // thread:changed accumulates here; the sync loop turns finished turns into topic reports.
  const pendingThreads = new Map<string, Set<string>>();
  async function botToken(): Promise<string> {
    const source = await tokenSource();
    if (source === "manual") return (await settings.get()).botToken!.trim();
    if (source === "env") return envToken.value;
    envToken.at = 0;
    throw new Error("bot_configuration_unavailable");
  }
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
      ingressError,
      menu:
        store.get<{ command: string; description: string }[]>("menu:served") ??
        [],
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
    const tg = telegram(botToken, lifetime.signal);
    const me = await checkBot(tg);
    const wanted = menuCommands(cfg.language as "ru" | "en");
    const signature = cfg.language + ":" + JSON.stringify(wanted);
    if (store.get("commandsLanguage") !== signature) {
      for (const language_code of ["", "ru", "en"])
        await tg("setMyCommands", {
          commands: wanted,
          scope: { type: "chat", chat_id: OWNER_ID },
          language_code,
        });
      // Read the menu back: the page shows what Telegram actually serves.
      const served = await tg<{ command: string; description: string }[]>(
        "getMyCommands",
        { scope: { type: "chat", chat_id: OWNER_ID } },
      );
      store.put("menu:served", served);
      if (JSON.stringify(served) === JSON.stringify(wanted))
        store.put("commandsLanguage", signature);
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
    const ev = await events();
    const folders = await folderState();
    const hidden = new Set(cfg.hideWithFolders ? folders.hidden : []);
    const visible = projects.filter((p) => !hidden.has("p:" + p.id));
    if (taskKindsOn(ev)) {
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
          if (ev.worker_error.on) {
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
    activeTasks = allTasks;
    // Topics live only in this database. An empty database must not recreate a full set
    // next to topics another installation already made: creation waits for explicit consent.
    if (!store.get("topicsBootstrapped")) {
      if (store.list("topic:").length) store.put("topicsBootstrapped", true);
      else {
        lastError = "topics_not_initialized";
        await publishProjection(cfg.projectionFile, allTasks);
        return;
      }
    }
    if (!topicsEnabled) {
      lastError = "threaded_mode_disabled";
      await publishProjection(cfg.projectionFile, allTasks);
      return;
    }
    await ensureTopic(store, tg, "navigation", tr("🧭 Навигация"));
    await ensureTopic(store, tg, "sms", "📱 SMS");
    // Telegram cannot hide a topic in a private chat: hiding removes it; showing creates a new one.
    for (const b of store.list<{ topicId: number; projectId: string; folderId?: string }>("chat:binding:").map((x) => x.value)) {
      const main = store.get<Topic>("topic:" + b.projectId)?.threadId === b.topicId;
      if (main || !(hidden.has("p:" + b.projectId) || (b.folderId && hidden.has("f:" + b.folderId)))) continue;
      await tg("deleteForumTopic", { message_thread_id: b.topicId }).catch((e) => {
        if (!(e instanceof TelegramFailure && e.code === "topic_missing")) throw e;
      });
      if (bridge) bridge.forget(b.topicId);
      else store.del("chat:binding:" + b.topicId);
    }
    for (const p of projects.filter((p) => hidden.has("p:" + p.id))) {
      const topic = store.get<Topic>("topic:" + p.id);
      if (!topic || topic.creating) continue;
      if (topic.threadId)
        await tg("deleteForumTopic", { message_thread_id: topic.threadId }).catch((e) => {
          if (!(e instanceof TelegramFailure && e.code === "topic_missing")) throw e;
        });
      bridge?.forget(topic.threadId ?? -1);
      store.del("chat:binding:" + topic.threadId);
      store.del("topic:" + p.id);
    }
    await reconcileProjects(store, tg, visible, cfg.deleteTopics);
    await collectThreadEvents(ev, visible, folders.folders, hidden);
    const base = new URL(cfg.appUrl);
    if (base.protocol !== "https:")
      throw new Error("public_https_url_required");
    for (const { value: topic } of store.list<Topic>("topic:")) {
      if (!topic.threadId || topic.missingSince) continue;
      let text =
        topic.key === "navigation"
          ? tr("<b>🧭 Рабочее пространство Кирилла</b>\n\n") +
            visible.map((p) => "📂 " + escapeHtml(p.name)).join("\n") +
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
                "</b>\n\nЗдесь появляются события задач и отчёты агентов этого проекта: кто закончил работу, кто ждёт ответа, что остановилось.\n\n/menu — управление чатом BB\n/new — новая сессия\n/chats — подключиться к существующему чату\n/model — агент и модель\n/tasks — задачи проекта\n\nКакие события присылать, настраивается на странице плагина, вкладка «События».",
              );
      // The BB iPhone app claims /projects/* links; the bare origin opens only in a browser.
      const open = topic.key.startsWith("proj_")
        ? base.origin + "/projects/" + encodeURIComponent(topic.key)
        : base.origin;
      const intro = text + "\n" + open;
      if (topic.introText === intro) continue;
      const payload = {
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: {
          inline_keyboard: [[{ text: tr("Открыть BB"), url: open }]],
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
      topic.introText = intro;
      store.put("topic:" + topic.key, topic);
    }
    await advanceSummaries(cfg.language as "ru" | "en", cfg);
    let sent = 0;
    for (const { key, value: e } of store.list<Event>("queue:")) {
      if (sent >= 15) break;
      if (e.summary?.state === "pending") continue;
      const agency = e.kind.startsWith("agency_");
      const kind = eventKind(e);
      const decision =
        e.kind === "test"
          ? { send: true, sound: false }
          : agency
            ? { send: cfg.agencyEnabled, sound: e.urgent }
            : kind
              ? route(ev, kind, e.projectId)
              : { send: false, sound: false };
      // Switched-off events and hidden or removed projects are dropped, not kept in the queue.
      if (!decision.send || !visible.some((p) => p.id === e.projectId)) {
        if (!agency || !cfg.agencyEnabled) store.del(key);
        continue;
      }
      const topic = store.get<Topic>("topic:" + e.projectId);
      if (!topic?.threadId) continue;
      if (agency && e.agencyTopicId !== topic.threadId) continue;
      // Keep deliveries bound to their original topic.
      // Tasks detail route verified through the live Tasks UI.
      const common = {
        message_thread_id: topic.threadId,
        disable_notification: !decision.sound,
        link_preview_options: { is_disabled: true },
        reply_markup: {
          inline_keyboard: [
            [
              ...(e.thread && cfg.chatEnabled && bridge
                ? [bridge.connectButton(topic.threadId, e.thread.threadId)].filter(
                    (k) => k !== undefined,
                  )
                : []),
              {
                text: e.thread
                  ? tr("Открыть в BB")
                  : e.kind === "test"
                    ? tr("Открыть Telegram Projects")
                    : tr("Открыть ") + String(e.key) + "",
                url:
                  base.origin +
                  (e.thread
                    ? "/projects/" +
                      encodeURIComponent(e.projectId) +
                      "/threads/" +
                      encodeURIComponent(e.thread.threadId)
                    : e.kind === "test"
                      ? "/plugins/telegram-projects/telegram-projects"
                      : agency
                        ? "/plugins/agency/overview/jobs/" + encodeURIComponent(e.key)
                        : "/plugins/tasks/tasks/task/" + encodeURIComponent(e.key)),
              },
            ],
          ],
        },
      };
      const html = {
        ...common,
        text: e.thread
          ? formatThreadCard(e.thread, cfg.language as "ru" | "en")
          : formatEvent(e, cfg.language as "ru" | "en"),
        parse_mode: "HTML",
      };
      // Agent reports go out as native Rich Messages; HTML stays as the fallback.
      if (e.thread && cfg.richReplies)
        await tg("sendRichMessage", {
          ...common,
          rich_message: {
            markdown: formatThreadRich(e.thread, cfg.language as "ru" | "en"),
          },
        }).catch((err) => {
          if (err instanceof TelegramFailure && err.code === "telegram_400")
            return tg("sendMessage", html);
          throw err;
        });
      else await tg("sendMessage", html);
      sent++;
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
  // A hidden worker thread writes the summary with the chosen BB model; the sync loop only
  // polls it, so a slow model never blocks other deliveries. Failures keep the full reply.
  async function advanceSummaries(
    language: "ru" | "en",
    cfg: {
      summaryProvider: string;
      summaryModel: string;
      summaryReasoning: string;
      summaryServiceTier: string;
    },
  ) {
    for (const { key, value: e } of store.list<Event>("queue:")) {
      if (e.summary?.state !== "pending" || !e.thread) continue;
      const summary = e.summary;
      const finish = async (text: string | null) => {
        if (text) {
          e.thread!.reply = text;
          e.thread!.summaryModel = cfg.summaryModel || cfg.summaryProvider || "BB";
        }
        e.summary = { ...summary, state: text ? "done" : "failed" };
        store.put(key, e);
        if (summary.workerId)
          await bb.sdk.threads
            .archive({ threadId: summary.workerId })
            .catch(() => {});
      };
      try {
        if (!summary.workerId) {
          const source = await bb.sdk.threads.get({ threadId: e.thread.threadId });
          if (!source.environmentId) {
            await finish(null);
            continue;
          }
          const worker = await bb.sdk.threads.spawn({
            projectId: e.projectId,
            environment: { type: "reuse", environmentId: source.environmentId },
            prompt: summaryPrompt(e.thread.title, e.thread.reply ?? "", language),
            title: "Telegram · саммери · " + e.thread.title.slice(0, 60),
            visibility: "hidden",
            ...(cfg.summaryProvider ? { providerId: cfg.summaryProvider } : {}),
            ...(cfg.summaryModel ? { model: cfg.summaryModel } : {}),
            ...(cfg.summaryReasoning
              ? { reasoningLevel: cfg.summaryReasoning as "low" }
              : {}),
            ...(cfg.summaryServiceTier
              ? { serviceTier: cfg.summaryServiceTier as "fast" }
              : {}),
            pluginMetadata: { role: "telegram-summary", threadId: e.thread.threadId },
          });
          e.summary = { state: "pending", workerId: worker.id, startedAt: Date.now() };
          store.put(key, e);
          continue;
        }
        const worker = await bb.sdk.threads.get({ threadId: summary.workerId });
        if (worker.status === "error" || worker.archivedAt || worker.deletedAt) {
          await finish(null);
          continue;
        }
        if (worker.status === "idle" && !worker.queuedMessageCount) {
          const out = await bb.sdk.threads
            .output({ threadId: summary.workerId, signal: lifetime.signal })
            .then((r) => r.output?.trim() || null)
            .catch(() => null);
          if (out) {
            await finish(out);
            continue;
          }
        }
        if (Date.now() - (summary.startedAt ?? 0) > 180_000) await finish(null);
      } catch {
        await finish(null);
      }
    }
  }
  async function collectThreadEvents(
    ev: Events,
    visible: { id: string; name: string }[],
    folders: Folder[],
    hidden: Set<string>,
  ) {
    const batch = [...pendingThreads];
    pendingThreads.clear();
    const bound = new Set(
      store
        .list<{ threadId: string | null }>("chat:binding:")
        .map((x) => x.value.threadId),
    );
    for (const [threadId, types] of batch) {
      try {
        const t = await bb.sdk.threads.get({ threadId, signal: lifetime.signal });
        const project = visible.find((p) => p.id === t.projectId);
        // Sub-agents, chats already mirrored into Telegram and closed threads stay quiet.
        if (
          !project ||
          t.parentThreadId ||
          bound.has(threadId) ||
          t.deletedAt ||
          t.archivedAt ||
          t.visibility === "hidden"
        )
          continue;
        const pending = await bb.sdk.threads.interactions
          .list({ threadId, signal: lifetime.signal })
          .then((list) => list.filter((i: any) => i.status === "pending" || !i.status))
          .catch(() => []);
        const previous = store.get<string>("thread:status:" + threadId);
        store.put("thread:status:" + threadId, t.status);
        const outcome = classifyThread(
          [...types],
          t.status,
          pending.length,
          previous,
        );
        if (!outcome) {
          // turn/completed can arrive while the status still reads active: look again next pass.
          if (["active", "starting", "stopping", "pending"].includes(t.status))
            pendingThreads.set(threadId, new Set([...types, ...(pendingThreads.get(threadId) ?? [])]));
          continue;
        }
        const kind = ("thread_" + outcome) as "thread_done";
        if (!route(ev, kind, project.id).send) continue;
        const env = t.environmentId
          ? await bb.sdk.environments
              .get({ environmentId: t.environmentId })
              .catch(() => null)
          : null;
        const section = sectionFor(
          folders.filter((f) => f.projectId === project.id),
          (env as { path?: string } | null)?.path,
        );
        if (section && hidden.has("f:" + section.id)) continue;
        const stamp =
          outcome === "attention"
            ? pending.map((i: any) => i.id).join(",")
            : String(t.updatedAt);
        const id = `thread:${threadId}:${outcome}:${stamp}`;
        if (store.get("sent:" + id)) continue;
        const reply =
          outcome === "attention"
            ? null
            : await bb.sdk.threads
                .output({ threadId, signal: lifetime.signal })
                .then((r) => r.output ?? null)
                .catch(() => null);
        const event: Event = {
          id,
          projectId: project.id,
          taskId: "",
          key: threadId,
          title: t.title || t.titleFallback || threadId,
          tracker: "",
          status: t.status,
          kind,
          dueDate: null,
          at: new Date().toISOString(),
          urgent: outcome !== "done",
          thread: {
            threadId,
            outcome,
            status: t.status,
            project: project.name,
            section: section?.name ?? null,
            title: t.title || t.titleFallback || threadId,
            agent: t.providerId,
            reply,
            at: Date.now(),
          },
        };
        const cfg = await settings.get();
        if (cfg.reportMode === "summary" && reply && reply.length > 500)
          event.summary = { state: "pending" };
        store.put("queue:" + id, event);
      } catch {
        // A thread that cannot be read now is retried with its next change.
      }
    }
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
    await writeJsonAtomic(path, data);
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
        tokenPresent: (await tokenSource()) !== "none",
        tokenSource: await tokenSource(),
        tokenEnv: c.tokenEnv,
      };
    },
    savePreferences: async (value) => {
      await settings.experimental_set(value);
      return true;
    },
    checkConnection: async ({ token }) => {
      const c = await settings.get();
      return diagnose(token?.trim() || (await botToken().catch(() => "")));
    },
    saveToken: async ({ token }) => {
      const clean = token.trim();
      const result = await diagnose(clean);
      if (result.valid && result.sameBot && !result.error && !result.webhook) {
        await settings.experimental_set({ botToken: clean });
      }
      return result;
    },
    eventsGet: async () => {
      const [ev, list, folders] = await Promise.all([
        events(),
        bb.sdk.projects.list({ signal: lifetime.signal }),
        folderState(),
      ]);
      return {
        events: ev,
        projects: list
          .filter((p) => p.kind === "standard")
          .map((p) => ({
            id: p.id,
            name: p.name,
            hidden: folders.hidden.includes("p:" + p.id),
            topicId: store.get<Topic>("topic:" + p.id)?.threadId ?? null,
          })),
      };
    },
    eventsSave: async (value) => {
      store.put("events:config", value);
      wake?.();
      return true;
    },
    syncMenu: async () => {
      store.del("commandsLanguage");
      await sync();
      return status();
    },
    // The native picker needs a concrete value: start from BB's own default model.
    summaryDefaults: async () => {
      const base = await bb.sdk.system.executionOptions({});
      const providerId =
        base.providers.find((p) => p.available)?.id ?? "claude-code";
      const options = await bb.sdk.system.executionOptions({ providerId });
      const model =
        options.models.find((m) => m.isDefault) ?? options.models[0];
      return {
        providerId,
        model: model?.model ?? "",
        reasoningLevel: model?.defaultReasoningEffort ?? "medium",
      };
    },
    useEnvToken: async () => {
      await settings.experimental_set({ botToken: null });
      envToken.at = 0;
      return (await tokenSource()) === "env";
    },
    initTopics: async () => {
      store.put("topicsBootstrapped", true);
      await sync();
      return status();
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
        // An empty database adopts existing topics; the next sync restores their names.
        const topic: Topic | undefined =
          key && /^(proj_\w+|sms|navigation)$/.test(key)
            ? (store.get<Topic>("topic:" + key) ?? {
                key,
                name: "",
                threadId: null,
                creating: false,
              })
            : undefined;
        const threadId = Number(id);
        if (!topic || !Number.isSafeInteger(threadId) || threadId <= 0)
          return { exitCode: 1, stderr: "invalid_binding" };
        if (
          store
            .list<Topic>("topic:")
            .some((x) => x.value.key !== key && x.value.threadId === threadId)
        )
          return { exitCode: 1, stderr: "topic_already_bound" };
        const tg = telegram(botToken, lifetime.signal);
        await checkBot(tg);
        if (topic.name)
          await tg("editForumTopic", {
            message_thread_id: threadId,
            name: topic.name,
          });
        store.put("topicsBootstrapped", true);
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
      const relevant = [
        "turn/completed",
        "system/thread/interrupted",
        "system/interaction/lifecycle",
        "system/userQuestion/lifecycle",
      ];
      const unsubscribeThreads = bb.sdk.subscribe({
        event: "thread:changed",
        callback: (e) => {
          const types = e.metadata?.eventTypes ?? [];
          const status = e.changes?.includes("status-changed");
          if (!e.id || (!status && !types.some((x) => relevant.includes(x))))
            return;
          const set = pendingThreads.get(e.id) ?? new Set<string>();
          for (const x of types) set.add(x);
          pendingThreads.set(e.id, set);
          wake?.();
        },
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
        unsubscribeThreads();
      }
    },
  });
  bb.background.service("telegram-chat", {
    async start(signal) {
      const spool = SPOOL;
      const control =
        "/Users/vechkasov/toolkit/service-bots/private/telegram-chat.json";
      const publishControl = makeChatControlPublisher(control);
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
      await mkdir(spool, { recursive: true, mode: 0o700 });
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
              await mkdir(spool, { recursive: true, mode: 0o700 });
              activeAbort = new AbortController();
              const bridgeSignal = AbortSignal.any([
                signal,
                activeAbort.signal,
                lifetime.signal,
              ]);
              bridge = new ChatBridge({
                store,
                sdk: bb.sdk,
                tg: telegram(botToken, bridgeSignal),
                spool,
                get baseUrl() {
                  return currentUrl;
                },
                signal: bridgeSignal,
                rich: () => rich,
                language: () => language,
                wake: wakeChat,
                transcribe: (v) =>
                  transcribeTelegramVoice(botToken, bb.sdk, v, bridgeSignal),
              });
              bridge.recover();
            }
            await publishControl(true, cfg.language);
            await bridge.tick();
          } else {
            activeAbort?.abort();
            await bridge?.dispose();
            bridge = undefined;
            await publishControl(false, cfg.language);
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
  function taskList(topicId: number, language: "ru" | "en") {
    const tr = (s: string) => translate(language, s);
    const projectId =
      store.list<Topic>("topic:").find((x) => x.value.threadId === topicId)
        ?.value.key ??
      bridge?.bindings().find((b) => b.topicId === topicId)?.projectId;
    const project = projectId?.startsWith("proj_")
      ? store.get<Topic>("topic:" + projectId)
      : undefined;
    const names: Record<string, string> = {
      backlog: tr("в планах"),
      todo: tr("к выполнению"),
      in_progress: tr("в работе"),
      in_review: tr("нужна проверка"),
    };
    const list = activeTasks.filter(
      (x) =>
        !["done", "canceled"].includes(x.task.status) &&
        (!project || x.tracker.linkedBbProjectId === project.key),
    );
    return (
      "📋 " +
      (project?.name ?? tr("Активные задачи")) +
      "\n\n" +
      (list.length
        ? list
            .slice(0, 12)
            .map(
              ({ task, tracker }) =>
                `${task.key} · ${tracker.name}\n${task.title.slice(0, 140)}\n${names[task.status] ?? task.status}`,
            )
            .join("\n\n")
        : tr("Активных задач нет.")) +
      (list.length > 12
        ? tr("\n\nЕщё ") + String(list.length - 12) + tr(" — в BB.")
        : "")
    ).slice(0, 3900);
  }
  bb.background.service("telegram-ingress", {
    async start(signal) {
      const pause = (ms: number) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(done, ms);
          function done() {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
          }
          signal.addEventListener("abort", done, { once: true });
        });
      const tg = telegram(botToken, signal, 40_000);
      while (!signal.aborted) {
        const cfg = await settings.get();
        if (!cfg.enabled) {
          ingressError = null;
          await pause(5000);
          continue;
        }
        try {
          const updates = await tg<any[]>("getUpdates", {
            offset: store.get<number>("ingress:offset") ?? 0,
            timeout: 25,
            allowed_updates: ["message", "callback_query"],
          });
          ingressError = null;
          for (const u of updates) {
            const route = routeUpdate(u);
            if (route.kind === "chat" && cfg.chatEnabled)
              writeSpool(SPOOL, route.input);
            else if (route.kind === "tasks")
              await tg("sendMessage", {
                message_thread_id: route.topicId || undefined,
                text: taskList(route.topicId, cfg.language as "ru" | "en"),
              });
            if (route.kind !== "tasks" && route.callbackId)
              await tg("answerCallbackQuery", {
                callback_query_id: route.callbackId,
              }).catch(() => {});
            store.put("ingress:offset", u.update_id + 1);
          }
        } catch (e) {
          if (signal.aborted) break;
          // telegram_409: another process still polls this bot.
          ingressError = safeError(e);
          await pause(10_000);
        }
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
