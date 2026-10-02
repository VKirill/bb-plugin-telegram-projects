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
function cardParts(c: ThreadCard, language: "ru" | "en") {
  const t = (ru: string, en: string) => (language === "en" ? en : ru);
  return {
    t,
    heading:
      c.outcome === "done"
        ? t("✅ Агент закончил работу", "✅ Agent finished")
        : c.outcome === "attention"
          ? t("✋ Агент ждёт ответа", "✋ Agent is waiting for you")
          : c.status === "error"
            ? t(
                "🔴 Тред остановился с ошибкой",
                "🔴 Thread stopped with an error",
              )
            : t("⏹ Тред остановлен", "⏹ Thread stopped"),
    place: [c.project, c.section].filter(Boolean).join(" › "),
    title: c.title.slice(0, 200),
    agent: agents[c.agent] ?? c.agent,
    when: new Date(c.at).toLocaleString(language === "en" ? "en-GB" : "ru-RU", {
      timeZone: "Europe/Madrid",
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    }),
  };
}
// HTML fallback for clients or chats where Rich Messages are refused.
export function formatThreadCard(c: ThreadCard, language: "ru" | "en") {
  const p = cardParts(c, language);
  const reply = c.reply?.trim()
    ? "\n\n<blockquote expandable>" +
      markdownExcerpt(c.reply) +
      "</blockquote>"
    : "";
  return (
    "<b>" +
    p.heading +
    "</b>\n📂 " +
    escapeHtml(p.place) +
    "\n🧵 <b>" +
    escapeHtml(p.title) +
    "</b>\n🤖 " +
    escapeHtml(p.agent) +
    " · " +
    escapeHtml(p.when) +
    reply
  );
}
const mdEscape = (s: string) => s.replace(/([\\`*_[\]|<>~=#])/g, "\\$1");
// Native Rich Message: Telegram renders the agent's Markdown itself (tables, code, headings).
export function formatThreadRich(c: ThreadCard, language: "ru" | "en") {
  const p = cardParts(c, language);
  let reply = c.reply?.trim() ?? "";
  if (reply.length > 3000) {
    const n = reply.lastIndexOf("\n", 3000);
    reply = reply.slice(0, n > 1500 ? n : 3000) + "\n\n…";
  }
  if ((reply.match(/^\s*```/gm) ?? []).length % 2) reply += "\n```";
  return (
    "**" +
    p.heading +
    "**\n\n📂 " +
    mdEscape(p.place) +
    "\n🧵 **" +
    mdEscape(p.title) +
    "**\n🤖 " +
    mdEscape(p.agent) +
    " · " +
    p.when +
    (reply
      ? "\n\n<details><summary>" +
        p.t("Ответ агента", "Agent reply") +
        "</summary>\n\n" +
        reply +
        "\n\n</details>"
      : "")
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

// Agent replies are Markdown; Telegram HTML has no tables, headings or lists.
function inline(text: string) {
  return text
    .split(/(`[^`]+`)/)
    .map((part) =>
      /^`[^`]+`$/.test(part)
        ? "<code>" + escapeHtml(part.slice(1, -1)) + "</code>"
        : escapeHtml(part)
            .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
            .replace(/__(.+?)__/g, "<b>$1</b>")
            .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,:;!?]|$)/g, "$1<i>$2</i>")
            .replace(
              /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
              '<a href="$2">$1</a>',
            ),
    )
    .join("");
}
const tableSeparator = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
export function markdownExcerpt(md: string, limit = 700) {
  let src = md.trim();
  let cut = false;
  if (src.length > limit) {
    const n = src.lastIndexOf("\n", limit);
    src = src.slice(0, n > limit / 2 ? n : limit);
    cut = true;
  }
  const lines = src.split("\n");
  const out: string[] = [];
  let code = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      code = !code;
      continue;
    }
    if (code) {
      out.push("<code>" + escapeHtml(line) + "</code>");
      continue;
    }
    if (tableSeparator.test(line)) continue;
    const row = line.match(/^\s*\|(.*)\|\s*$/);
    if (row) {
      const cells = row[1].split("|").map((x) => inline(x.trim()));
      const header = tableSeparator.test(lines[i + 1] ?? "");
      const text = cells.join(" · ");
      out.push(header ? "<b>" + text + "</b>" : text);
      continue;
    }
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (heading) {
      out.push("<b>" + inline(heading[1]) + "</b>");
      continue;
    }
    const item = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (item) {
      out.push(item[1] + "• " + inline(item[2]));
      continue;
    }
    out.push(inline(line));
  }
  return out.join("\n").trim() + (cut ? "…" : "");
}
