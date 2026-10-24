import test from "node:test";
import assert from "node:assert/strict";
import { lanePhaseReader, type PhaseSnap } from "../adapters.ts";
import { ingestPhases, formatEvent, STALE_READ_MS, type Store, type Event } from "../model.ts";
import { laneKindsOn, taskKindsOn, readEvents, eventKind } from "../events.ts";
import { routeUpdate } from "../ingress.ts";
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
const queued = (s: Store) => s.list("queue:").map((r) => r.value as Event);
const project = { id: "proj_a", name: "Vampirism" };
const phase: PhaseSnap = { id: "ph1", title: "Rounds", stage: "planning", state: "active", pmThreadId: "thr_pm", next: "write the plan", word: null, questions: [] };

test("the phase reader keeps open questions and the turn that waits for the owner's word", async () => {
  const read = lanePhaseReader(async (method, input) => {
    assert.equal(method, "phase_list");
    assert.deepEqual(input, { projectId: "proj_a" });
    return [{ id: "ph1", title: "Rounds", stage: "acceptance", state: "active", pmThreadId: "thr_pm", extra: 1,
      record: { questions: [{ id: "q1", text: "Which map?" }, { id: "q2", text: "Old", answer: "done" }] },
      next: { text: "your word at uat", key: "ph1:acceptance:word:uat:2" } }];
  });
  const [p] = await read("proj_a");
  assert.equal(p.word, "uat:2");
  assert.deepEqual(p.questions, [{ id: "q1", text: "Which map?" }]);
  assert.equal(p.pmThreadId, "thr_pm");
});

test("the first phase read is silent; then stage, question, word and closing are queued once", () => {
  const s = memory();
  ingestPhases(s, project, [{ ...phase, questions: [{ id: "q0", text: "seen before" }] }], 1_000);
  assert.equal(queued(s).length, 0);
  ingestPhases(s, project, [{ ...phase, stage: "design", questions: [{ id: "q0", text: "seen before" }, { id: "q1", text: "Which map?" }] }], 2_000);
  const kinds = queued(s).map((e) => e.kind).sort();
  assert.deepEqual(kinds, ["phase_question", "phase_stage"]);
  const q = queued(s).find((e) => e.kind === "phase_question")!;
  assert.deepEqual(q.phase, { phaseId: "ph1", questionId: "q1" });
  assert.equal(q.urgent, true);
  assert.equal(eventKind(q), "phase_question");
  ingestPhases(s, project, [{ ...phase, stage: "design", word: "design", questions: [] }], 3_000);
  const word = queued(s).find((e) => e.kind === "phase_word")!;
  assert.deepEqual(word.phase, { phaseId: "ph1", turn: "design" });
  // The same word read again is not queued twice.
  ingestPhases(s, project, [{ ...phase, stage: "design", word: "design", questions: [] }], 4_000);
  assert.equal(queued(s).filter((e) => e.kind === "phase_word").length, 1);
  ingestPhases(s, project, [{ ...phase, stage: "closed", state: "closed", word: null }], 5_000);
  assert.equal(queued(s).filter((e) => e.kind === "phase_closed").length, 1);
  assert.equal(queued(s).filter((e) => e.kind === "phase_stage").length, 1);
});

test("a phase read after a long pause is a new baseline", () => {
  const s = memory();
  ingestPhases(s, project, [phase], 1_000);
  ingestPhases(s, project, [{ ...phase, stage: "execution", word: "planning" }], 1_000 + STALE_READ_MS + 1);
  assert.equal(queued(s).length, 0);
});

test("phase messages say what the phase needs", () => {
  const e: Event = { id: "ph:ph1:q:q1", projectId: "proj_a", taskId: "ph1", key: "ph1", title: "Rounds <b>", tracker: "Vampirism", status: "design",
    kind: "phase_question", detail: "Which map?", at: new Date(0).toISOString(), urgent: true, phase: { phaseId: "ph1", questionId: "q1" } };
  const ru = formatEvent(e);
  assert.match(ru, /Фаза спрашивает/);
  assert.match(ru, /Rounds &lt;b&gt;/);
  assert.match(ru, /Ответьте на это сообщение/);
  assert.match(formatEvent({ ...e, kind: "phase_stage" }), /стадию: чертёж/);
  assert.match(formatEvent({ ...e, kind: "phase_word" }, "en"), /waits for your word/);
});

test("phase events poll Lane Pilot without turning task notices back on", () => {
  const ev = readEvents(null, { notifyTasks: false });
  assert.equal(taskKindsOn(ev), false);
  assert.equal(laneKindsOn(ev), true);
  for (const k of ["phase_stage", "phase_question", "phase_word", "phase_closed"] as const) ev[k].on = false;
  assert.equal(laneKindsOn(ev), false);
});

test("ph: buttons and replies reach the server", () => {
  const owner = 259034221;
  const chat = { id: owner, type: "private" };
  const cb = routeUpdate({ update_id: 1, callback_query: { id: "7", from: { id: owner }, data: "ph:y:ph1:uat:2", message: { message_id: 4, chat, message_thread_id: 5 } } }, owner);
  assert.equal(cb.kind === "chat" && cb.input.callback, "ph:y:ph1:uat:2");
  const reply = routeUpdate({ update_id: 2, message: { message_id: 9, chat, from: { id: owner }, message_thread_id: 5, text: "Карта старая", reply_to_message: { message_id: 4 } } }, owner);
  assert.equal(reply.kind === "chat" && reply.input.replyTo, 4);
});
