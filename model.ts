import { translate, type Language } from "./locale";
/** A Lane Pilot task seen through its latest attempt (the status vocabulary of the old Tasks plugin, plus blocked). */
export type TaskStatus = "todo" | "in_progress" | "done" | "canceled" | "blocked";
export type Task = {
  id: string;
  runId: string;
  title: string;
  status: TaskStatus;
  attemptId: string;
  /** Why the latest attempt ended blocked; null otherwise. */
  reason: string | null;
  /** The run's last change, in ms; names one blocked episode. */
  runUpdatedAt: number;
};
export type Project = { id: string; name: string };
export type Topic = {
  key: string;
  name: string;
  threadId: number | null;
  creating: boolean;
  missingSince?: number;
  introId?: number;
  introText?: string;
};
export type Event = {
  agencyTopicId?: number;
  /** BB thread reports (kind thread_*): who did what and where. */
  thread?: import("./events").ThreadCard & { threadId: string };
  /** Summary mode: the card waits for a hidden worker thread, then falls back to the full reply. */
  summary?: {
    state: "pending" | "done" | "failed";
    workerId?: string;
    startedAt?: number;
  };
  id: string;
  projectId: string;
  taskId: string;
  key: string;
  title: string;
  tracker: string;
  status: string;
  kind: string;
  /** Short extra line: why an attempt ended blocked. */
  detail?: string;
  at: string;
  urgent: boolean;
};
export interface Store {
  get<T>(key: string): T | undefined;
  put(key: string, value: unknown): void;
  del(key: string): void;
  list<T>(prefix: string): { key: string; value: T }[];
  atomic(fn: () => void): void;
}
export const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export const states: Record<string, string> = {
  todo: "К выполнению",
  in_progress: "В работе",
  in_review: "Нужна проверка",
  blocked: "Заблокирована",
  done: "Завершено",
  canceled: "Отменено",
};
export function changes(prev: Task | undefined, next: Task): string[] {
  // A task can appear already finished: report both steps.
  const step = (): string[] =>
    next.status === "blocked"
      ? ["worker_error"]
      : next.status === "done" || next.status === "canceled"
        ? ["status"]
        : [];
  if (!prev)
    return next.status === "in_progress"
      ? ["created", "started"]
      : ["created", ...step()];
  if (prev.status === next.status) return [];
  return next.status === "in_progress" && prev.status === "todo"
    ? ["started"]
    : step();
}
/** timeZone: an IANA zone such as Europe/Madrid; empty means the server's zone. */
export function formatEvent(
  e: Event,
  language: Language = "ru",
  timeZone = "",
) {
  const tr = (s: string) => translate(language, s);
  const heading =
    e.kind === "agency_question"
      ? tr("❓ Агентство: нужен ответ")
      : e.kind === "agency_notice"
        ? tr("Агентство · уведомление")
        : e.kind === "test"
          ? tr("🧪 Проверка уведомлений")
          : e.kind === "worker_error"
            ? tr("🔴 Ошибка исполнителя")
            : e.kind === "created"
              ? tr("🆕 Новая задача")
              : e.kind === "started"
                ? tr("▶️ Исполнитель начал работу")
                : e.status === "done"
                  ? tr("✅ Задача завершена")
                  : e.status === "canceled"
                    ? tr("⏹ Задача отменена")
                    : tr("🔄 Статус задачи");
  return (
    "<b>" +
    String(heading) +
    "</b>\n" +
    String(escapeHtml(e.tracker.slice(0, 150))) +
    " · <code>" +
    String(escapeHtml(e.key)) +
    "</code>\n\n<b>" +
    String(escapeHtml(e.title.slice(0, 500))) +
    tr("</b>\nСтатус: ") +
    String(escapeHtml(tr(states[e.status] ?? e.status))) +
    "" +
    String(
      e.detail ? "\n<code>" + escapeHtml(e.detail.slice(0, 300)) + "</code>" : "",
    ) +
    "\n\n<i>" +
    String(
      escapeHtml(
        new Date(e.at).toLocaleString(language === "en" ? "en-GB" : "ru-RU", {
          ...(timeZone ? { timeZone } : {}),
        }),
      ),
    ) +
    "</i>"
  );
}
const taskKey = (projectId: string, t: Pick<Task, "runId" | "id">) =>
  `lptask:${projectId}:${t.runId}:${t.id}`;
/** A read after a pause this long is a new baseline: what changed while the plugin was off is history, not news. */
export const STALE_READ_MS = 30 * 60_000;
/** A task event older than this in the queue is dropped instead of sent. */
export const STALE_EVENT_MS = 6 * 3_600_000;
export const staleEvent = (e: Pick<Event, "kind" | "at">, now = Date.now()) =>
  !e.kind.startsWith("agency_") && e.kind !== "test" && now - Date.parse(e.at) > STALE_EVENT_MS;
/** Compare a project's Lane Pilot tasks with the last snapshot and queue what changed. The first read is silent, and so is a read after a long pause. */
export function ingest(
  store: Store,
  project: Project,
  tasks: Task[],
  now = Date.now(),
) {
  const lastRead = store.get<number>("lpread:" + project.id) ?? 0;
  const baseline = store.get<boolean>("lpbaseline:" + project.id) && now - lastRead <= STALE_READ_MS;
  store.atomic(() => {
    const seen = new Set<string>();
    for (const task of tasks) {
      const key = taskKey(project.id, task);
      seen.add(key);
      const old = store.get<Task>(key);
      if (baseline)
        for (const kind of changes(old, task)) {
          const e: Event = {
            id:
              kind === "worker_error"
                ? `lp:${task.runId}:${task.id}:${task.attemptId}:${task.runUpdatedAt}:error`
                : `lp:${task.runId}:${task.id}:${kind === "status" ? task.status : kind}`,
            projectId: project.id,
            taskId: task.id,
            key: task.id,
            title: task.title,
            tracker: project.name,
            status: task.status,
            kind,
            ...(kind === "worker_error" && task.reason
              ? { detail: task.reason }
              : {}),
            at: new Date(now).toISOString(),
            urgent: kind === "worker_error",
          };
          if (!store.get("sent:" + e.id)) store.put("queue:" + e.id, e);
        }
      store.put(key, task);
    }
    // Runs that left the page Lane Pilot returns are finished history.
    for (const { key } of store.list("lptask:" + project.id + ":"))
      if (!seen.has(key)) store.del(key);
    store.put("lpbaseline:" + project.id, true);
    store.put("lpread:" + project.id, now);
  });
}
/** Snapshot keys the Tasks plugin used; Lane Pilot replaced it. */
export function dropTasksSnapshots(store: Store) {
  store.atomic(() => {
    for (const prefix of ["task:", "visible:", "tracker:", "baseline:", "worker:"])
      for (const { key } of store.list(prefix)) store.del(key);
  });
}
export function topicName(p: Project) {
  return p.name.slice(0, 128);
}
export class TelegramFailure extends Error {
  constructor(
    public code: string,
    public retryAfter = 30,
    public ambiguous = false,
  ) {
    super(code);
  }
}
export type Telegram = <T = any>(
  method: string,
  body: Record<string, unknown>,
) => Promise<T>;
export async function ensureTopic(
  store: Store,
  tg: Telegram,
  key: string,
  name: string,
): Promise<Topic> {
  let topic = store.get<Topic>("topic:" + key);
  if (topic?.creating) throw new Error("topic_creation_uncertain:" + key);
  if (!topic?.threadId) {
    topic = { key, name, threadId: null, creating: true };
    store.put("topic:" + key, topic);
    try {
      const r = await tg<{ message_thread_id: number }>("createForumTopic", {
        name,
        icon_color: 7322096,
      });
      if (
        !Number.isSafeInteger(r.message_thread_id) ||
        r.message_thread_id <= 0
      )
        throw new TelegramFailure("invalid_topic_response", 30, true);
      topic.threadId = r.message_thread_id;
      topic.creating = false;
      store.put("topic:" + key, topic);
    } catch (e) {
      if (e instanceof TelegramFailure && !e.ambiguous) {
        topic.creating = false;
        store.put("topic:" + key, topic);
      }
      throw e;
    }
  }
  if (topic.name !== name) {
    await tg("editForumTopic", { message_thread_id: topic.threadId, name });
    topic.name = name;
    store.put("topic:" + key, topic);
  }
  if (topic.missingSince) {
    delete topic.missingSince;
    store.put("topic:" + key, topic);
  }
  return topic;
}
export async function reconcileProjects(
  store: Store,
  tg: Telegram,
  projects: Project[],
  deleteRemoved: boolean,
  now = Date.now(),
) {
  for (const p of projects) await ensureTopic(store, tg, p.id, topicName(p));
  const live = new Set(projects.map((p) => p.id));
  for (const { value: topic } of store.list<Topic>("topic:proj_")) {
    if (live.has(topic.key)) continue;
    if (!topic.missingSince) {
      topic.missingSince = now;
      store.put("topic:" + topic.key, topic);
      continue;
    }
    if (!deleteRemoved || now - topic.missingSince < 30_000 || !topic.threadId)
      continue;
    try {
      await tg("deleteForumTopic", { message_thread_id: topic.threadId });
    } catch (e) {
      if (!(e instanceof TelegramFailure && e.code === "topic_missing"))
        throw e;
    }
    store.atomic(() => {
      store.del("topic:" + topic.key);
      for (const { key, value: e } of store.list<Event>("queue:"))
        if (e.projectId === topic.key) store.del(key);
    });
  }
}
