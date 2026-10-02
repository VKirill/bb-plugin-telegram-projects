import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyThread,
  defaultEvents,
  eventKind,
  formatThreadCard,
  readEvents,
  route,
  sectionFor,
  taskKindsOn,
} from "../events";
test("a finished turn, a stop, an error and a pending question are told apart", () => {
  assert.equal(classifyThread(["turn/completed"], "idle", 0), "done");
  assert.equal(classifyThread(["turn/completed"], "active", 0), null);
  assert.equal(classifyThread(["system/thread/interrupted"], "idle", 0), "stopped");
  assert.equal(classifyThread([], "error", 0, "active"), "stopped");
  assert.equal(classifyThread([], "error", 0, "error"), null);
  assert.equal(classifyThread([], "error", 0), null);
  assert.equal(classifyThread(["turn/completed"], "idle", 1), "attention");
  assert.equal(classifyThread(["item/started"], "active", 0), null);
});
test("task events map to their rule; done and review are separate from other statuses", () => {
  assert.equal(eventKind({ kind: "status", status: "done" }), "task_done");
  assert.equal(eventKind({ kind: "status", status: "in_review" }), "task_review");
  assert.equal(eventKind({ kind: "status", status: "canceled" }), "task_status");
  assert.equal(eventKind({ kind: "created", status: "todo" }), "task_created");
  assert.equal(eventKind({ kind: "thread_done", status: "idle" }), "thread_done");
  assert.equal(eventKind({ kind: "agency_notice", status: "" }), null);
});
test("project filter and sound follow the rule", () => {
  const ev = defaultEvents();
  ev.task_done = { on: true, sound: true, projects: ["proj_a"] };
  assert.deepEqual(route(ev, "task_done", "proj_a"), { send: true, sound: true });
  assert.deepEqual(route(ev, "task_done", "proj_b"), { send: false, sound: false });
  ev.thread_done.on = false;
  assert.equal(route(ev, "thread_done", "proj_a").send, false);
});
test("former flags seed the first configuration; broken rules fall back one by one", () => {
  const ev = readEvents(null, { notifyTasks: false, soundOnReview: false });
  assert.equal(taskKindsOn(ev), false);
  assert.equal(ev.thread_done.on, true);
  assert.equal(ev.thread_attention.sound, false);
  const mixed = readEvents({ task_done: { on: false, sound: false, projects: null }, task_due: "x" });
  assert.equal(mixed.task_done.on, false);
  assert.equal(mixed.task_due.on, true);
});
test("thread card is signed with project, section, thread and agent and escapes HTML", () => {
  const text = formatThreadCard(
    {
      outcome: "done",
      status: "idle",
      project: "Клиенты",
      section: "Сайт <b>",
      title: "Лендинг & форма",
      agent: "claude-code",
      reply: "Готово: <script>",
      at: Date.UTC(2026, 9, 2, 12, 0),
    },
    "ru",
  );
  assert.match(text, /✅ Агент закончил работу/);
  assert.match(text, /📂 Клиенты › Сайт &lt;b&gt;/);
  assert.match(text, /🧵 <b>Лендинг &amp; форма<\/b>/);
  assert.match(text, /🤖 Claude Code · /);
  assert.match(text, /<blockquote expandable>Готово: &lt;script&gt;<\/blockquote>/);
});
test("the deepest folder containing the working directory is the section", () => {
  const folders = [
    { id: "a", path: "/p" },
    { id: "b", path: "/p/site" },
    { id: "c", path: "/p/site-old" },
  ];
  assert.equal(sectionFor(folders, "/p/site/src")?.id, "b");
  assert.equal(sectionFor(folders, "/p/site")?.id, "b");
  assert.equal(sectionFor(folders, "/p/other")?.id, "a");
  assert.equal(sectionFor(folders, "/q"), undefined);
});
test("agent Markdown becomes Telegram HTML: bold, code, tables, lists, links", async () => {
  const { markdownExcerpt } = await import("../events");
  const html = markdownExcerpt(
    "## Итог\nОн сам (`orchestrator`) и **writer**.\n\n| День | Всего |\n|---|---|\n| 27.09 | 25 |\n\n- пункт <x>\n[док](https://e.x/a?b=1&c=2)\nsnake_case_name",
  );
  assert.equal(
    html,
    '<b>Итог</b>\nОн сам (<code>orchestrator</code>) и <b>writer</b>.\n\n<b>День · Всего</b>\n27.09 · 25\n\n• пункт &lt;x&gt;\n<a href="https://e.x/a?b=1&amp;c=2">док</a>\nsnake_case_name',
  );
  const long = markdownExcerpt("строка **жирная**\n".repeat(60), 100);
  assert.ok(long.endsWith("…"));
  assert.equal((long.match(/<b>/g) ?? []).length, (long.match(/<\/b>/g) ?? []).length);
});
test("rich card keeps the agent Markdown, escapes metadata and closes a cut code fence", async () => {
  const { formatThreadRich } = await import("../events");
  const md = formatThreadRich(
    {
      outcome: "done",
      status: "idle",
      project: "Клиенты",
      section: null,
      title: "Fix *bold* | table",
      agent: "codex",
      reply: "| a | b |\n|---|---|\n| 1 | 2 |\n\n```\n" + "x\n".repeat(2000),
      at: Date.UTC(2026, 9, 2, 12, 0),
    },
    "ru",
  );
  assert.match(md, /^### ✅ Агент закончил работу\n\n\*\*Fix \\\*bold\\\* \\\| table\*\*\n\n📂 Клиенты · 🤖 Codex · 🕒 /);
  assert.match(md, /<details><summary>Ответ агента<\/summary>\n\n\| a \| b \|/);
  assert.equal((md.match(/^\s*```/gm) ?? []).length % 2, 0);
  assert.ok(md.endsWith("</details>"));
});
test("summary card shows the summary openly and names the model; the prompt forbids tools", async () => {
  const { formatThreadRich, summaryPrompt } = await import("../events");
  const md = formatThreadRich(
    {
      outcome: "done",
      status: "idle",
      project: "Клиенты",
      section: null,
      title: "T",
      agent: "codex",
      reply: "- сделано\n- проверено",
      at: 0,
      summaryModel: "claude-code / haiku",
    },
    "ru",
  );
  assert.ok(!md.includes("<details>"));
  assert.match(md, /- сделано\n- проверено\n\n<footer>Саммери: claude-code \/ haiku<\/footer>$/);
  const prompt = summaryPrompt("Тред", "x".repeat(20000), "ru");
  assert.match(prompt, /Не используй инструменты/);
  assert.ok(prompt.length < 12500);
});
