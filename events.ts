import { z } from "zod";
import { escapeHtml, type Event } from "./model";

export const EVENT_KINDS = [
  "task_created",
  "task_started",
  "task_status",
  "task_review",
  "task_done",
  "task_due",
  "worker_error",
  "thread_done",
  "thread_attention",
  "thread_stopped",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const eventRuleSchema = z
  .object({
    on: z.boolean(),
    sound: z.boolean(),
    /** null: every project; otherwise only the listed project IDs. */
    projects: z.array(z.string().max(64)).max(200).nullable(),
  })
  .strict();
export type EventRule = z.infer<typeof eventRuleSchema>;
export const eventsSchema = z
  .object(
    Object.fromEntries(EVENT_KINDS.map((k) => [k, eventRuleSchema])) as Record<
      EventKind,
      typeof eventRuleSchema
    >,
  )
  .strict();
export type Events = z.infer<typeof eventsSchema>;

const rule = (on: boolean, sound: boolean): EventRule => ({
  on,
  sound,
  projects: null,
});
// Former flags notifyTasks / notifyWorkerErrors / soundOnReview seed the first configuration.
export function defaultEvents(old?: {
  notifyTasks?: boolean;
  notifyWorkerErrors?: boolean;
  soundOnReview?: boolean;
}): Events {
  const tasks = old?.notifyTasks ?? true;
  const sound = old?.soundOnReview ?? true;
  return {
    task_created: rule(tasks, false),
    task_started: rule(tasks, false),
    task_status: rule(tasks, false),
    task_review: rule(tasks, sound),
    task_done: rule(tasks, false),
    task_due: rule(tasks, false),
    worker_error: rule(tasks && (old?.notifyWorkerErrors ?? true), sound),
    thread_done: rule(true, false),
    thread_attention: rule(true, sound),
    thread_stopped: rule(true, sound),
  };
}
export function readEvents(
  raw: unknown,
  old?: Parameters<typeof defaultEvents>[0],
) {
  const base = defaultEvents(old);
  if (!raw || typeof raw !== "object") return base;
  // Unknown or broken rules fall back to defaults one by one; new kinds appear enabled.
  for (const k of EVENT_KINDS) {
    const r = eventRuleSchema.safeParse((raw as Record<string, unknown>)[k]);
    if (r.success) base[k] = r.data;
  }
  return base;
}
export function eventKind(e: Pick<Event, "kind" | "status">): EventKind | null {
  if (e.kind.startsWith("thread_")) return e.kind as EventKind;
  if (e.kind === "worker_error") return "worker_error";
  if (e.kind === "created") return "task_created";
  if (e.kind === "started") return "task_started";
  if (e.kind === "due") return "task_due";
  if (e.kind === "status")
    return e.status === "in_review"
      ? "task_review"
      : e.status === "done"
        ? "task_done"
        : "task_status";
  return null;
}
export function route(events: Events, kind: EventKind, projectId: string) {
  const r = events[kind];
  const send = r.on && (!r.projects || r.projects.includes(projectId));
  return { send, sound: send && r.sound };
}
export const taskKindsOn = (events: Events) =>
  EVENT_KINDS.some((k) => !k.startsWith("thread_") && events[k].on);

export type ThreadOutcome = "done" | "attention" | "stopped";
// BB reports what happened in the thread; the current status decides whether the turn really ended.
// An error counts only as a fresh transition: restarts re-announce old failed threads otherwise.
export function classifyThread(
  types: readonly string[],
  status: string,
  pending: number,
  previous?: string,
): ThreadOutcome | null {
  if (pending > 0) return "attention";
  if (
    types.includes("system/thread/interrupted") ||
    (status === "error" && previous !== undefined && previous !== "error")
  )
    return "stopped";
  if (status === "idle" && types.includes("turn/completed")) return "done";
  return null;
}
export type ThreadCard = {
  outcome: ThreadOutcome;
  status: string;
  project: string;
  section: string | null;
  title: string;
  agent: string;
  reply: string | null;
  at: number;
};
const agents: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  gemini: "Gemini",
};
export function formatThreadCard(c: ThreadCard, language: "ru" | "en") {
  const t = (ru: string, en: string) => (language === "en" ? en : ru);
  const heading =
    c.outcome === "done"
      ? t("✅ Агент закончил работу", "✅ Agent finished")
      : c.outcome === "attention"
        ? t("✋ Агент ждёт ответа", "✋ Agent is waiting for you")
        : c.status === "error"
          ? t(
              "🔴 Тред остановился с ошибкой",
              "🔴 Thread stopped with an error",
            )
          : t("⏹ Тред остановлен", "⏹ Thread stopped");
  const place = [c.project, c.section].filter(Boolean).join(" › ");
  const reply = c.reply?.trim()
    ? "\n\n<blockquote expandable>" +
      escapeHtml(
        c.reply.trim().length > 700
          ? c.reply.trim().slice(0, 700) + "…"
          : c.reply.trim(),
      ) +
      "</blockquote>"
    : "";
  return (
    "<b>" +
    heading +
    "</b>\n📂 " +
    escapeHtml(place) +
    "\n🧵 <b>" +
    escapeHtml(c.title.slice(0, 200)) +
    "</b>\n🤖 " +
    escapeHtml(agents[c.agent] ?? c.agent) +
    " · " +
    escapeHtml(
      new Date(c.at).toLocaleString(language === "en" ? "en-GB" : "ru-RU", {
        timeZone: "Europe/Madrid",
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
      }),
    ) +
    reply
  );
}
// The deepest folder that contains the thread's working directory names its section.
export function sectionFor<T extends { path: string }>(
  folders: T[],
  path: string | null | undefined,
): T | undefined {
  if (!path) return undefined;
  return folders
    .filter(
      (f) =>
        path === f.path || path.startsWith(f.path.replace(/\/$/, "") + "/"),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];
}
