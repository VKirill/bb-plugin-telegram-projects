import { translate, type Language } from "./locale";
import { z } from "zod";
export const taskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  key: z.string(),
  title: z.string(),
  status: z.enum([
    "backlog",
    "todo",
    "in_progress",
    "in_review",
    "done",
    "canceled",
  ]),
  dueDate: z.string().nullable(),
  updatedAt: z.string(),
  createdAt: z.string().optional(),
  agentsWorking: z.number().optional().default(0),
});
export type Task = z.infer<typeof taskSchema>;
export type Project = { id: string; name: string };
export type Tracker = {
  id: string;
  name: string;
  linkedBbProjectId: string | null;
};
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
  dueDate: string | null;
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
  backlog: "В планах",
  todo: "К выполнению",
  in_progress: "В работе",
  in_review: "Нужна проверка",
  done: "Завершено",
  canceled: "Отменено",
};
export function changes(prev: Task | undefined, next: Task): string[] {
  // A task can be created and finished between two polls: report both steps.
  if (!prev)
    return ["done", "in_review", "canceled"].includes(next.status)
      ? ["created", "status"]
      : ["created"];
  const out: string[] = [];
  if (prev.status !== next.status) out.push("status");
  else if (!prev.agentsWorking && next.agentsWorking > 0) out.push("started");
  if (prev.dueDate !== next.dueDate) out.push("due");
  return out;
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
                : e.kind === "due"
                  ? tr("📅 Изменён срок")
                  : e.status === "in_review"
                    ? tr("👀 Нужна проверка")
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
      e.dueDate
        ? tr("\nСрок: ") + escapeHtml(e.dueDate)
        : e.kind === "due"
          ? tr("\nСрок снят")
          : "",
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
export function ingest(
  store: Store,
  tracker: Tracker,
  tasks: Task[],
  now = Date.now(),
) {
  if (!tracker.linkedBbProjectId) return;
  const baseline = store.get<boolean>("baseline:" + tracker.id);
  store.atomic(() => {
    for (const task of tasks) {
      const old = store.get<Task>("task:" + task.id);
      if (
        baseline ||
        (task.createdAt &&
          Date.parse(task.createdAt) >=
            (store.get<number>("trackingSince") ?? Infinity))
      )
        for (const kind of changes(old, task)) {
          const e: Event = {
            id: `${task.id}:${task.updatedAt}:${kind}:${task.agentsWorking}`,
            projectId: tracker.linkedBbProjectId!,
            taskId: task.id,
            key: task.key,
            title: task.title,
            tracker: tracker.name,
            status: task.status,
            kind,
            dueDate: task.dueDate,
            at: new Date(now).toISOString(),
            urgent: task.status === "in_review",
          };
          if (!store.get("sent:" + e.id)) store.put("queue:" + e.id, e);
        }
      store.put("task:" + task.id, task);
    }
    store.put("visible:" + tracker.id, tasks);
    store.put("tracker:" + tracker.id, tracker);
    store.put("baseline:" + tracker.id, true);
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
