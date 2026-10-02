import test from "node:test";
import assert from "node:assert/strict";
import { routeUpdate } from "../ingress";
import { OWNER_ID } from "../model";
const chat = { id: OWNER_ID, type: "private" };
const from = { id: OWNER_ID };
test("owner text in a topic becomes a chat input", () => {
  const r = routeUpdate({
    update_id: 7,
    message: {
      message_id: 3,
      chat,
      from,
      message_thread_id: 42,
      text: "привет",
    },
  });
  assert.equal(r.kind, "chat");
  assert.deepEqual(r.kind === "chat" && r.input, {
    updateId: 7,
    ownerId: OWNER_ID,
    chatId: OWNER_ID,
    topicId: 42,
    messageId: 3,
    text: "привет",
    callback: undefined,
    replyTo: undefined,
    voice: undefined,
  });
});
test("other users, groups and foreign callbacks are ignored", () => {
  const other = { message_id: 1, chat, from: { id: 1 }, text: "x" };
  assert.equal(routeUpdate({ update_id: 1, message: other }).kind, "ignore");
  const group = {
    message_id: 1,
    chat: { id: OWNER_ID, type: "group" },
    from,
    text: "x",
  };
  assert.equal(routeUpdate({ update_id: 1, message: group }).kind, "ignore");
  const cb = routeUpdate({
    update_id: 2,
    callback_query: {
      id: "9",
      from,
      data: "sms:copy",
      message: { message_id: 1, chat },
    },
  });
  assert.deepEqual(cb, { kind: "ignore", callbackId: "9" });
});
test("/tasks is answered by the plugin; bb: callbacks and new topics reach the bridge", () => {
  assert.deepEqual(
    routeUpdate({
      update_id: 3,
      message: {
        message_id: 1,
        chat,
        from,
        message_thread_id: 5,
        text: "/tasks@aivech_bot",
      },
    }),
    { kind: "tasks", topicId: 5 },
  );
  const cb = routeUpdate({
    update_id: 4,
    callback_query: {
      id: "8",
      from,
      data: "bb:menu",
      message: { message_id: 2, chat, message_thread_id: 5 },
    },
  });
  assert.equal(cb.kind === "chat" && cb.input.callback, "bb:menu");
  assert.equal(cb.kind === "chat" && cb.callbackId, "8");
  const created = routeUpdate({
    update_id: 5,
    message: {
      message_id: 3,
      chat,
      from,
      message_thread_id: 6,
      forum_topic_created: { name: "x" },
    },
  });
  assert.equal(created.kind === "chat" && created.input.text, "/project");
});
