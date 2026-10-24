import test from "node:test";
import assert from "node:assert/strict";
import {
  changes,
  dropTasksSnapshots,
  ingest,
  ensureTopic,
  reconcileProjects,
  formatEvent,
  TelegramFailure,
  type Store,
  type Task,
  type Topic,
} from "../model.ts";
function memory(): Store {
  const data = new Map<string, unknown>();
  return {
    get: (k) => structuredClone(data.get(k)) as any,
    put: (k, v) => {
      data.set(k, structuredClone(v));
    },
    del: (k) => {
      data.delete(k);
    },
    list: (p) =>
      [...data]
        .filter(([k]) => k.startsWith(p))
        .map(([key, value]) => ({ key, value: structuredClone(value) as any })),
    atomic: (fn) => fn(),
  };
}
const task: Task = {
  id: "fix-login",
  runId: "run1",
  title: "Task <script>",
  status: "todo",
  attemptId: "att1",
  reason: null,
  runUpdatedAt: 1000,
};
const project = { id: "proj_one", name: "Research" };
const queued = (s: Store) => s.list<any>("queue:").map((x) => x.value);
test("baseline silent; each step queues once in its project", () => {
  const s = memory();
  ingest(s, project, [task]);
  assert.equal(queued(s).length, 0);
  const running = { ...task, status: "in_progress" as const };
  ingest(s, project, [running]);
  ingest(s, project, [running]);
  assert.deepEqual(queued(s).map((e) => e.kind), ["started"]);
  assert.equal(queued(s)[0].projectId, "proj_one");
  assert.equal(queued(s)[0].tracker, "Research");
  ingest(s, project, [{ ...running, status: "done" }]);
  assert.deepEqual(queued(s).map((e) => e.kind).sort(), ["started", "status"]);
  assert.deepEqual(changes(task, { ...task, title: "rename" }), []);
});
test("a task seen first already finished reports both steps", () => {
  assert.deepEqual(changes(undefined, { ...task, status: "done" }), ["created", "status"]);
  assert.deepEqual(changes(undefined, { ...task, status: "todo" }), ["created"]);
  assert.deepEqual(changes(undefined, { ...task, status: "in_progress" }), ["created", "started"]);
  assert.deepEqual(changes(undefined, { ...task, status: "blocked" }), ["created", "worker_error"]);
});
test("blocked is a worker error with the reason, urgent, once per episode", () => {
  const s = memory();
  ingest(s, project, [{ ...task, status: "in_progress" }]);
  const blocked = {
    ...task,
    status: "blocked" as const,
    reason: "needs_human: <add a path>",
    runUpdatedAt: 2000,
  };
  ingest(s, project, [blocked]);
  ingest(s, project, [blocked]);
  const [e] = queued(s);
  assert.equal(queued(s).length, 1);
  assert.equal(e.kind, "worker_error");
  assert.equal(e.urgent, true);
  assert.equal(e.detail, "needs_human: <add a path>");
  const text = formatEvent(e);
  assert.match(text, /Ошибка исполнителя/);
  assert.match(text, /&lt;add a path&gt;/);
  // A retry that works and then blocks again is a new episode.
  ingest(s, project, [{ ...blocked, status: "in_progress", attemptId: "att2" }]);
  ingest(s, project, [{ ...blocked, attemptId: "att2", runUpdatedAt: 3000 }]);
  assert.equal(queued(s).length, 2);
});
test("an event already sent is not queued again", () => {
  const s = memory();
  ingest(s, project, [{ ...task, status: "in_progress" }]);
  ingest(s, project, [{ ...task, status: "done" }]);
  const [e] = queued(s);
  s.del("queue:" + e.id);
  s.put("sent:" + e.id, 1);
  s.put("lptask:proj_one:run1:fix-login", { ...task, status: "in_progress" });
  ingest(s, project, [{ ...task, status: "done" }]);
  assert.equal(queued(s).length, 0);
});
test("snapshots of runs that left the page are dropped; other projects stay", () => {
  const s = memory();
  ingest(s, project, [task, { ...task, runId: "run0" }]);
  ingest(s, { id: "proj_two", name: "Two" }, [task]);
  ingest(s, project, [task]);
  assert.deepEqual(
    s.list("lptask:").map((x) => x.key).sort(),
    ["lptask:proj_one:run1:fix-login", "lptask:proj_two:run1:fix-login"],
  );
});
test("old Tasks plugin snapshots are removed, Lane Pilot ones stay", () => {
  const s = memory();
  for (const k of ["task:a", "visible:t", "tracker:t", "baseline:t", "worker:w", "lptask:p:r:t", "sent:x"])
    s.put(k, 1);
  dropTasksSnapshots(s);
  assert.deepEqual(s.list("").map((x) => x.key).sort(), ["lptask:p:r:t", "sent:x"]);
});
test("create persists; rename does not recreate; deletion waits", async () => {
  const s = memory();
  const calls: string[] = [];
  const tg: any = async (m: string) => {
    calls.push(m);
    return { message_thread_id: 10 };
  };
  await reconcileProjects(s, tg, [{ id: "proj_one", name: "One" }], true, 1000);
  await reconcileProjects(
    s,
    tg,
    [{ id: "proj_one", name: "Renamed" }],
    true,
    2000,
  );
  assert.deepEqual(calls, ["createForumTopic", "editForumTopic"]);
  await reconcileProjects(s, tg, [], true, 3000);
  await reconcileProjects(s, tg, [], true, 31000);
  assert.ok(s.get("topic:proj_one"));
  await reconcileProjects(s, tg, [], true, 34000);
  assert.equal(s.get("topic:proj_one"), undefined);
  assert.equal(calls.at(-1), "deleteForumTopic");
});
test("reappearing project clears deletion grace; opt-out preserves topic", async () => {
  const s = memory();
  const tg: any = async () => ({ message_thread_id: 10 });
  await reconcileProjects(s, tg, [{ id: "proj_one", name: "One" }], true, 1000);
  await reconcileProjects(s, tg, [], true, 2000);
  await reconcileProjects(
    s,
    tg,
    [{ id: "proj_one", name: "One" }],
    true,
    35000,
  );
  assert.equal(s.get<Topic>("topic:proj_one")?.missingSince, undefined);
  await reconcileProjects(s, tg, [], false, 40000);
  await reconcileProjects(s, tg, [], false, 80000);
  assert.ok(s.get("topic:proj_one"));
});
test("ambiguous creation never auto-repeats; 429 permits retry", async () => {
  const s = memory();
  let n = 0;
  const tg: any = async () => {
    n++;
    throw new TelegramFailure("telegram_network", 30, true);
  };
  await assert.rejects(ensureTopic(s, tg, "proj_one", "One"));
  await assert.rejects(ensureTopic(s, tg, "proj_one", "One"), /uncertain/);
  assert.equal(n, 1);
  const s2 = memory();
  await assert.rejects(
    ensureTopic(
      s2,
      async () => {
        throw new TelegramFailure("telegram_429", 60, false);
      },
      "proj_one",
      "One",
    ),
  );
  assert.equal(s2.get<Topic>("topic:proj_one")?.creating, false);
});
test("hostile text escaped", () => {
  const text = formatEvent({
    id: "e",
    projectId: "p",
    taskId: "t",
    key: "TEST-1",
    title: "<b>evil</b>",
    tracker: "x & y",
    status: "done",
    kind: "status",
    at: "2026-09-12T10:00:00Z",
    urgent: true,
  });
  assert.match(text, /&lt;b&gt;evil/);
  assert.match(text, /x &amp; y/);
});

test("a read after a long pause is a new baseline, and a stale event is not sent", async () => {
  const { staleEvent, STALE_READ_MS } = await import("../model");
  const s = memory();
  ingest(s, project, [task], 1_000);
  ingest(s, project, [{ ...task, status: "done" }], 1_000 + STALE_READ_MS + 1);
  assert.equal(queued(s).length, 0);
  ingest(s, project, [{ ...task, status: "canceled" }], 1_000 + STALE_READ_MS + 2);
  assert.equal(queued(s).length, 1);
  assert.equal(staleEvent({ kind: "status", at: new Date(0).toISOString() }, 7 * 3_600_000), true);
  assert.equal(staleEvent({ kind: "test", at: new Date(0).toISOString() }, 7 * 3_600_000), false);
});
