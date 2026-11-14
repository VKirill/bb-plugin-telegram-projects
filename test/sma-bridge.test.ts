// SMA parity proofs for the chat bridge: the same brain as the window, the «typing» sign, the draft that waits for «yes», the refusal of
// attachments. The bridge runs on a stand-in BB (test/sma-bridge-support.ts); Telegram is a recording function. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { routeUpdate } from "../ingress";
import { bridgeFixture, OWNER_ID } from "./sma-bridge-support";

test("[sma:m_tg_one_brain] a Telegram message is a turn of the BB conversation: the first one starts a visible chat with the owner's words, the next goes into the same chat", async () => {
  const f = bridgeFixture();
  try {
    await f.bridge.handle(f.input("Собери мне лендинг"));
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0]![0], "spawn");
    assert.equal(f.calls[0]![1].prompt, "Собери мне лендинг");
    assert.equal(f.calls[0]![1].projectId, "proj_one");
    assert.equal(f.calls[0]![1].visibility, "visible");
    await f.bridge.handle(f.input("И добавь форму"));
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1]![0], "send");
    assert.equal(f.calls[1]![1].threadId, "thr_one");
    assert.deepEqual(f.calls[1]![1].input, [{ type: "text", text: "И добавь форму", mentions: [] }]);
    assert.equal(f.bridge.bindings().find((b) => b.topicId === 100)?.threadId, "thr_one");
  } finally {
    f.cleanup();
  }
});

test("[sma:m_tg_typing] while the BB chat works the «typing» sign goes out and is renewed before Telegram's five seconds run out, not on every look", async () => {
  const f = bridgeFixture();
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  try {
    await f.bridge.handle(f.input("Начни работу"));
    const typing = () => f.sent.filter((c) => c.method === "sendChatAction");
    // The chat is idle: no sign.
    await f.bridge.observe();
    assert.equal(typing().length, 0);
    // The chat works: one sign, with the action and the topic.
    f.thread.status = "active";
    await f.bridge.observe();
    await f.bridge.observe();
    assert.equal(typing().length, 1);
    assert.equal(typing()[0].action, "typing");
    assert.equal(typing()[0].message_thread_id, 100);
    // Four seconds later it is still the same sign; five seconds later it is renewed once.
    clock += 4000;
    await f.bridge.observe();
    assert.equal(typing().length, 1);
    clock += 1000;
    await f.bridge.observe();
    assert.equal(typing().length, 2);
    // The work is over: no more signs.
    f.thread.status = "idle";
    clock += 20_000;
    await f.bridge.observe();
    assert.equal(typing().length, 2);
  } finally {
    Date.now = realNow;
    f.cleanup();
  }
});

test("[sma:m_tg_draft_note] with «new chat only after yes» the first message waits as a draft and a whole «да» starts the chat with it; other words replace the draft", async () => {
  const f = bridgeFixture({ confirmNewChat: true });
  try {
    await f.bridge.handle(f.input("Напиши стихотворение"));
    assert.deepEqual(f.calls, []);
    assert.equal(f.data.get("chat:draft:100"), "Напиши стихотворение");
    await f.bridge.flush();
    assert.deepEqual(f.sent.filter((c) => c.method === "sendMessage").map((c) => c.text), ["Начать новый чат BB с этим сообщением? Ответь «да»."]);
    // Other words replace the draft; nothing starts.
    await f.bridge.handle(f.input("Лучше напиши рассказ"));
    assert.deepEqual(f.calls, []);
    assert.equal(f.data.get("chat:draft:100"), "Лучше напиши рассказ");
    // A whole «да» starts the chat with the draft, not with the word «да».
    await f.bridge.handle(f.input("да"));
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0]![0], "spawn");
    assert.equal(f.calls[0]![1].prompt, "Лучше напиши рассказ");
    assert.equal(f.data.has("chat:draft:100"), false);
  } finally {
    f.cleanup();
  }
});

test("[sma:m_tg_draft_note] without the setting the first message starts the chat at once, and a «да» with no draft is only a draft itself when the setting is on", async () => {
  const f = bridgeFixture();
  try {
    await f.bridge.handle(f.input("Напиши стихотворение"));
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0]![1].prompt, "Напиши стихотворение");
    assert.equal(f.data.has("chat:draft:100"), false);
  } finally {
    f.cleanup();
  }
  const g = bridgeFixture({ confirmNewChat: true });
  try {
    await g.bridge.handle(g.input("да"));
    assert.deepEqual(g.calls, []);
    assert.equal(g.data.get("chat:draft:100"), "да");
  } finally {
    g.cleanup();
  }
});

test("[sma:m_tg_non_text] a sticker is refused politely by the router, a photo or a file reaches the bridge without words and is refused there; nothing starts a chat", async () => {
  const sticker = { update_id: 1, message: { message_id: 10, from: { id: OWNER_ID }, chat: { id: OWNER_ID, type: "private" }, message_thread_id: 7, sticker: { file_id: "s" } } };
  assert.deepEqual(routeUpdate(sticker, OWNER_ID), { kind: "refuse", topicId: 7 });
  const location = { update_id: 2, message: { message_id: 11, from: { id: OWNER_ID }, chat: { id: OWNER_ID, type: "private" }, location: { latitude: 1, longitude: 2 } } };
  assert.deepEqual(routeUpdate(location, OWNER_ID), { kind: "refuse", topicId: 0 });
  // Words are never refused, and a sticker from a stranger is not answered by the refusal.
  assert.equal(routeUpdate({ update_id: 3, message: { message_id: 12, from: { id: OWNER_ID }, chat: { id: OWNER_ID, type: "private" }, text: "привет" } }, OWNER_ID).kind, "chat");
  assert.equal(routeUpdate({ ...sticker, message: { ...sticker.message, from: { id: 9 }, chat: { id: 9, type: "private" } } }, OWNER_ID).kind, "stranger");

  const f = bridgeFixture();
  try {
    const photo = { update_id: 4, message: { message_id: 13, from: { id: OWNER_ID }, chat: { id: OWNER_ID, type: "private" }, message_thread_id: 100, photo: [{ file_id: "p" }], caption: "вот" } };
    const doc = { update_id: 5, message: { message_id: 14, from: { id: OWNER_ID }, chat: { id: OWNER_ID, type: "private" }, message_thread_id: 100, document: { file_id: "d" } } };
    for (const u of [photo, doc]) {
      const route = routeUpdate(u, OWNER_ID);
      assert.equal(route.kind, "chat");
      assert.equal(route.kind === "chat" ? route.input.text : "x", undefined);
      if (route.kind === "chat") await f.bridge.handle(route.input);
    }
    await f.bridge.flush();
    assert.deepEqual(f.calls, []);
    const said = f.sent.filter((c) => c.method === "sendMessage").map((c) => c.text);
    assert.deepEqual(said, ["Отправь текст или голосовое сообщение. Вложения пока открывай в BB.", "Отправь текст или голосовое сообщение. Вложения пока открывай в BB."]);
  } finally {
    f.cleanup();
  }
});
