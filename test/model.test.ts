import test from "node:test";
import assert from "node:assert/strict";
import {
  changes,
  ingest,
  ensureTopic,
  reconcileProjects,
  formatEvent,
  TelegramFailure,
  type Store,
  type Task,
  type Topic,
} from "../model.ts";
import { readTasks } from "../adapters.ts";
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
  id: "t1",
  projectId: "tracker",
  key: "TEST-1",
  title: "Task <script>",
  status: "todo",
  dueDate: null,
  updatedAt: "2026-09-12T10:00:00Z",
  agentsWorking: 0,
};
const tracker = {
  id: "tracker",
  name: "Research",
  linkedBbProjectId: "proj_one",
};
test("baseline silent; meaningful changes enqueue once in linked project", () => {
  const s = memory();
  ingest(s, tracker, [task]);
  assert.equal(s.list("queue:").length, 0);
  const next = {
    ...task,
    status: "in_review" as const,
    updatedAt: "2026-09-12T11:00:00Z",
  };
  ingest(s, tracker, [next]);
  ingest(s, tracker, [next]);
  assert.equal(s.list("queue:").length, 1);
  assert.equal((s.list("queue:")[0].value as any).projectId, "proj_one");
  assert.deepEqual(changes(task, { ...task, title: "rename" }), []);
  assert.deepEqual(changes(undefined, { ...task, status: "done" }), ["created", "status"]);
  assert.deepEqual(changes(undefined, { ...task, status: "todo" }), ["created"]);
});
test("unlinked tracker never leaks into another project", () => {
  const s = memory();
  ingest(s, { ...tracker, linkedBbProjectId: null }, [task]);
  assert.equal(s.list("").length, 0);
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
test("pagination reads all pages; repeated cursor fails", async () => {
  let n = 0;
  const rows = await readTasks(
    async () => ({
      tasks: [{ ...task, id: String(n) }],
      nextCursor: n++ === 0 ? "next" : null,
    }),
    "tracker",
  );
  assert.equal(rows.length, 2);
  await assert.rejects(
    readTasks(async () => ({ tasks: [task], nextCursor: "same" }), "tracker"),
    /pagination_invalid/,
  );
});
test("worker stop is not completion; hostile text escaped", () => {
  assert.deepEqual(changes({ ...task, agentsWorking: 1 }, task), []);
  const text = formatEvent({
    id: "e",
    projectId: "p",
    taskId: "t",
    key: "TEST-1",
    title: "<b>evil</b>",
    tracker: "x & y",
    status: "in_review",
    kind: "status",
    dueDate: null,
    at: "2026-09-12T10:00:00Z",
    urgent: true,
  });
  assert.match(text, /&lt;b&gt;evil/);
  assert.match(text, /x &amp; y/);
});
test("a new tracker created after activation delivers its new tasks", () => {
  const s = memory();
  s.put("trackingSince", Date.parse("2026-09-12T09:00:00Z"));
  ingest(s, tracker, [{ ...task, createdAt: "2026-09-12T10:00:00Z" }]);
  assert.equal(s.list("queue:").length, 1);
});
