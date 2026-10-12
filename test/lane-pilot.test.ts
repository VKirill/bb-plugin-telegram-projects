import test from "node:test";
import assert from "node:assert/strict";
import { lanePilotReader, statusOf } from "../adapters.ts";
import { ingest, type Store } from "../model.ts";

const attempt = (task_id: string, state: string, attempt_no = 1, reason: string | null = null) => ({
  id: `${task_id}-${attempt_no}`,
  state,
  attempt_no,
  task_id,
  reason,
  thread_id: null,
  cliReceiptJson: null,
});
// A fake Lane Pilot: list_runs / get_run_card answers like the real RPC and counts calls.
function fakeLane(runs: any[], titles: Record<string, string> = {}) {
  const calls: string[] = [];
  const rpc = async (method: string, input: any) => {
    calls.push(method);
    if (method === "list_runs") return { runs, total: runs.length };
    if (method === "get_run_card")
      return {
        runId: input.runId,
        tasks: Object.entries(titles).map(([id, title]) => ({ id, title })),
      };
    throw new Error("unexpected " + method);
  };
  return { rpc, calls };
}
const memory = (): Store => {
  const data = new Map<string, unknown>();
  return {
    get: (k) => structuredClone(data.get(k)) as any,
    put: (k, v) => void data.set(k, structuredClone(v)),
    del: (k) => void data.delete(k),
    list: (p) =>
      [...data]
        .filter(([k]) => k.startsWith(p))
        .map(([key, value]) => ({ key, value: structuredClone(value) as any })),
    atomic: (fn) => fn(),
  };
};

test("attempt states map to task statuses; retries stay in progress", () => {
  assert.equal(statusOf("accepted"), "done");
  assert.equal(statusOf("canceled"), "canceled");
  assert.equal(statusOf("blocked"), "blocked");
  assert.equal(statusOf("queued"), "todo");
  for (const s of ["running", "spawn_requested", "provider_error", "validation_failed", "cancel_requested"])
    assert.equal(statusOf(s), "in_progress");
});

test("a task is its latest attempt; titles come from the run card, cached", async () => {
  const lane = fakeLane(
    [
      {
        id: "run1",
        state: "running",
        kind: "cli",
        updated_at: 5000,
        attempts: [attempt("a", "validation_failed", 1), attempt("a", "running", 2), attempt("b", "accepted")],
      },
    ],
    { a: "Fix the login", b: "Add docs" },
  );
  const read = lanePilotReader(lane.rpc);
  const tasks = await read("proj_one");
  assert.deepEqual(
    tasks.map((t) => [t.id, t.title, t.status, t.attemptId]),
    [
      ["a", "Fix the login", "in_progress", "a-2"],
      ["b", "Add docs", "done", "b-1"],
    ],
  );
  await read("proj_one");
  assert.deepEqual(lane.calls, ["list_runs", "get_run_card", "list_runs"]);
});

test("a failed run card leaves the task id as title; a long blocked reason is cut", async () => {
  const rpc = async (method: string) => {
    if (method === "get_run_card") throw new Error("boom");
    return {
      runs: [
        {
          id: "run1",
          state: "blocked",
          updated_at: 1,
          attempts: [attempt("a", "blocked", 1, "x".repeat(900))],
        },
      ],
    };
  };
  const [t] = await lanePilotReader(rpc)("proj_one");
  assert.equal(t.title, "a");
  assert.equal(t.status, "blocked");
  assert.equal(t.reason?.length, 300);
});

test("old closed runs are not asked for titles", async () => {
  const lane = fakeLane([
    { id: "r", state: "closed", updated_at: 1, attempts: [attempt("a", "accepted")] },
  ]);
  await lanePilotReader(lane.rpc)("proj_one");
  assert.deepEqual(lane.calls, ["list_runs"]);
});

test("an answer in another shape is refused, not guessed", async () => {
  await assert.rejects(lanePilotReader(async () => ({ runs: [{ id: 1 }] }))("p"));
});

test("end to end: a blocked task alerts once with its reason, then stays quiet", async () => {
  const s = memory();
  const run = (state: string, reason: string | null, updated_at: number) => [
    { id: "run1", state: "running", updated_at, attempts: [attempt("a", state, 1, reason)] },
  ];
  const project = { id: "proj_one", name: "Research" };
  let runs = run("running", null, 1);
  const read = lanePilotReader(async (method: string) =>
    method === "list_runs" ? { runs } : { tasks: [{ id: "a", title: "Fix the login" }] },
  );
  ingest(s, project, await read(project.id));
  runs = run("blocked", "needs_human: add src/x.ts to owns_paths", 2);
  ingest(s, project, await read(project.id));
  ingest(s, project, await read(project.id));
  const queue = s.list<any>("queue:").map((x) => x.value);
  assert.equal(queue.length, 1);
  assert.deepEqual(
    [queue[0].kind, queue[0].title, queue[0].detail, queue[0].projectId],
    ["worker_error", "Fix the login", "needs_human: add src/x.ts to owns_paths", "proj_one"],
  );
});
