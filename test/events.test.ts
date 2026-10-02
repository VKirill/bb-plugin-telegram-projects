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
