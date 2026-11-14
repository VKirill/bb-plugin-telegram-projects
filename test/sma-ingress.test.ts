// SMA parity proofs for the Telegram bridge loop (the plugin's «telegram-ingress» and «telegram-chat» services): the real plugin on the
// SDK's fake host against a stand-in Bot API (test/sma-support.ts). No network, no real BB CLI, no hub.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeTelegram, fastTimers, pluginHost, runUntilDrained, update, OWNER, type Host } from "./sma-support";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function waitFor(check: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await sleep(5);
  assert.ok(check(), "the condition did not come true in time");
}
/** Runs `body` with the stand-in API and short timers, and puts everything back. */
const started: Array<{ controller: AbortController }> = [];
const svc = (host: Host, name: string) => {
  const run = host.harness.behavior.runService(name);
  started.push(run);
  return run;
};
async function world(body: (tg: ReturnType<typeof fakeTelegram>, timers: ReturnType<typeof fastTimers>) => Promise<void>) {
  const tg = fakeTelegram();
  const timers = fastTimers();
  try {
    await body(tg, timers);
  } finally {
    for (const run of started.splice(0)) run.controller.abort();
    tg.restore();
    timers.restore();
  }
}
const SECONDS_10_MIN = 10 * 60_000;
async function withClock<T>(offset: number, body: () => Promise<T>): Promise<T> {
  const real = Date.now;
  Date.now = () => real() + offset;
  try {
    return await body();
  } finally {
    Date.now = real;
  }
}
const paired = async (settings = {}) => {
  const host = await pluginHost(settings);
  host.store.put("owner:id", OWNER);
  return host;
};

test("[sma:m_tg_null] without a bot nothing runs: switched off, or on without a token, the plugin asks Telegram for nothing", async () => {
  await world(async (tg) => {
    // Switched off (the default): the loop only looks at the setting.
    const off = await pluginHost({ enabled: false });
    const run = off.harness.behavior.runService("telegram-ingress");
    await sleep(80);
    run.controller.abort();
    await run.done;
    assert.deepEqual(tg.calls, []);
    assert.deepEqual(off.store.keys(), []);
    assert.equal(off.harness.inspection.sdk.calls.length, 0);
    assert.equal((await off.rpc("status")).link, "off");
    // On, but no token in the settings and none in the Env Catalog: no request leaves, the window is told why.
    const bare = await pluginHost({ botToken: "" });
    const again = bare.harness.behavior.runService("telegram-ingress");
    await sleep(80);
    again.controller.abort();
    await again.done;
    assert.deepEqual(tg.calls, []);
    assert.equal((await bare.rpc("status")).ingressError, "bot_configuration_unavailable");
  });
});

test("[sma:m_tg_poll] the poll asks for 25 seconds of waiting, from the stored position, for messages and button presses, with a ceiling of its own above the wait", async () => {
  await world(async (tg) => {
    const host = await paired();
    const group = { update_id: 7, message: { message_id: 1, from: { id: OWNER }, chat: { id: -5, type: "supergroup" }, text: "hi" } };
    tg.script.push([group]);
    await runUntilDrained(host, tg);
    const polls = tg.calls.filter((c) => c.method === "getUpdates");
    assert.equal(polls.length, 2);
    assert.deepEqual(polls[0]!.body, { offset: 0, timeout: 25, allowed_updates: ["message", "callback_query"] });
    assert.deepEqual(polls[1]!.body, { offset: 8, timeout: 25, allowed_updates: ["message", "callback_query"] });
    // The round's own ceiling is longer than the wait it asks for, so a slow round fails by itself instead of jamming the loop.
    assert.ok(polls.every((c) => c.deadline === 40_000 && c.deadline > 25 * 1000));
    assert.ok(polls.every((c) => c.token === "123456:SMAsecretTOKENabcdefghijklmnop"));
  });
});

test("[sma:m_tg_backoff] after every failed poll the loop waits twice as long as before up to a ceiling, and a good poll starts the waits over", async () => {
  await world(async (tg, timers) => {
    const host = await paired();
    tg.script.push("network", { code: 409, description: "Conflict: terminated by other getUpdates request" }, "html", "network", "network", "network", "network", [], "network");
    await runUntilDrained(host, tg);
    // What the plugin really does: 10 s, doubling, never more than 5 minutes (the card says 5 s up to a minute: see the report).
    assert.deepEqual(timers.delays.filter((d) => d >= 10_000), [10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 10_000]);
    assert.equal((await host.rpc("status")).ingressError, "telegram_network");
  });
});

test("[sma:m_tg_stranger] a stranger's chat gets one sentence, once, and never the conversation: no conversation row, no BB call, the owner stays", async () => {
  await world(async (tg) => {
    const host = await paired({ chatEnabled: true });
    tg.script.push([update(1, 99, "привет"), update(2, 99, "ты тут?"), update(3, 100, "эй"), { update_id: 4, callback_query: { id: "c1", from: { id: 99 }, data: "bb:x", message: { message_id: 1, from: { id: 99 }, chat: { id: 99, type: "private" } } } }]);
    host.store.put("owner:id", OWNER);
    // No chat bridge is running here: were the strangers' words routed to the conversation, the loop would be holding them.
    const sentence = "Этот бот работает только со своим владельцем.";
    const run = svc(host, "telegram-chat");
    await sleep(60);
    await runUntilDrained(host, tg);
    run.controller.abort();
    await run.done;
    assert.deepEqual(tg.sent().map((b) => [b.chat_id, b.text]), [[99, sentence], [100, sentence]]);
    assert.equal(host.store.get("owner:id"), OWNER);
    assert.deepEqual(host.store.keys("chat:in:"), []);
    assert.deepEqual(host.store.keys("stranger:"), ["stranger:100", "stranger:99"]);
    assert.equal(host.harness.inspection.sdk.calls.length, 0);
  });
});

test("[sma:m_tg_pair_code] the first private chat that sends /start with the live code becomes the pair; a wrong code, a group and an old code pair nobody", async () => {
  await world(async (tg) => {
    const host = await pluginHost();
    const { code } = await host.rpc("pairing");
    assert.match(code, /^[A-Z2-9]{8}$/);
    const group = { update_id: 2, message: { message_id: 20, from: { id: 56 }, chat: { id: -100, type: "supergroup" }, text: "/start " + code } };
    tg.script.push([update(1, 55, "/start WRONG222"), group, update(3, 57, "/start"), update(4, 58, code)]);
    await runUntilDrained(host, tg);
    assert.equal((await host.rpc("status")).owner, null);
    assert.deepEqual(tg.sent(), []);
    // Right code, private chat: paired, the code is spent, the chat is told.
    tg.script.push([update(5, 55, "/start " + code)]);
    await runUntilDrained(host, tg);
    assert.equal((await host.rpc("status")).owner, 55);
    assert.equal((await host.rpc("pairing")).code, null);
    assert.deepEqual(tg.sent().map((b) => [b.chat_id, b.text]), [[55, "✅ Бот привязан к BB. Темы проектов появятся в этом чате в течение минуты."]]);
  });
  await world(async (tg) => {
    // A code older than ten minutes pairs nobody.
    const host = await pluginHost();
    const { code } = await host.rpc("pairing");
    tg.script.push([update(1, 55, "/start " + code)]);
    await withClock(SECONDS_10_MIN + 1000, () => runUntilDrained(host, tg));
    assert.equal((await host.rpc("status")).owner, null);
    assert.deepEqual(tg.sent(), []);
  });
});

test("[sma:m_tg_paired] after pairing the words of that chat go to the conversation (the chat bridge takes them in) and nobody else's do", async () => {
  await world(async (tg) => {
    const host = await pluginHost({ chatEnabled: true });
    const { code } = await host.rpc("pairing");
    const chat = svc(host, "telegram-chat");
    tg.script.push([update(1, 55, "/start " + code), update(2, 55, "собери мне сайт"), update(3, 66, "я чужой")]);
    await runUntilDrained(host, tg);
    const row = () => host.store.get<{ input: { ownerId: number; chatId: number; topicId: number }; state: string }>("chat:in:2");
    // The bridge takes the message in and handles it: with no project bound to the chat it answers the owner (its own words, not a model's).
    await waitFor(() => row()?.state === "done" && tg.sent().length === 3);
    chat.controller.abort();
    await chat.done;
    assert.equal(host.store.get("owner:id"), 55);
    assert.deepEqual(host.store.keys("chat:in:"), ["chat:in:2"]);
    assert.deepEqual([row()!.input.ownerId, row()!.input.chatId], [55, 55]);
    const to = (chat: number) => tg.sent().filter((b) => b.chat_id === chat).map((b) => b.text);
    assert.deepEqual(to(55), ["✅ Бот привязан к BB. Темы проектов появятся в этом чате в течение минуты.", "Сначала привяжи эту тему командой /project. В теме SMS сообщения не отправляются агенту."]);
    // The stranger got the one sentence and nothing from the conversation.
    assert.deepEqual(to(66), ["Этот бот работает только со своим владельцем."]);
  });
});

test("[sma:m_tg_no_brain] while the conversation is not connected the link works, but the owner's words get one explanation an hour and never reach the conversation", async () => {
  await world(async (tg) => {
    const host = await paired({ chatEnabled: false });
    tg.script.push([update(1, OWNER, "привет"), update(2, OWNER, "эй, ты тут?")]);
    await runUntilDrained(host, tg);
    const said = "Общение с BB из Telegram выключено. Включи его на странице плагина Telegram Projects.";
    assert.deepEqual(tg.sent().map((b) => [b.chat_id, b.text]), [[OWNER, said]]);
    assert.deepEqual(host.store.keys("chat:in:"), []);
    assert.equal((await host.rpc("status")).link, "linked");
    // An hour later it is said again.
    tg.script.push([update(3, OWNER, "ну?")]);
    await withClock(3_600_000 + 5000, () => runUntilDrained(host, tg));
    assert.equal(tg.sent().length, 2);
  });
});

test("[sma:m_tg_bridge] the chat bridge is built from the current settings: held back while off, built when on, taken down when switched off — without a restart", async () => {
  await world(async (tg) => {
    const dir = mkdtempSync(join(tmpdir(), "sma-companion-"));
    try {
      const control = join(dir, "telegram-chat.json");
      const state = () => (existsSync(control) ? (JSON.parse(readFileSync(control, "utf8")) as { enabled: boolean }).enabled : undefined);
      const host = await paired({ chatEnabled: true, companionDir: dir });
      // Chat is on and the owner is paired, but no bridge exists yet: the poll holds back, so no update is consumed and lost.
      const held = host.harness.behavior.runService("telegram-ingress");
      await sleep(80);
      held.controller.abort();
      await held.done;
      assert.deepEqual(tg.calls, []);
      // The chat service builds the bridge from the settings and publishes that it is on.
      const chat = svc(host, "telegram-chat");
      await waitFor(() => state() === true);
      tg.script.push([update(1, OWNER, "работаем")]);
      await runUntilDrained(host, tg);
      assert.ok(tg.calls.some((c) => c.method === "getUpdates"));
      assert.deepEqual(host.store.keys("chat:in:"), ["chat:in:1"]);
      // Chat is switched off in the settings: the bridge is taken down on the next pass, the plugin keeps running.
      await host.harness.behavior.setSettings({ chatEnabled: false });
      await waitFor(() => state() === false);
      assert.equal((await host.rpc("status")).chatEnabled, false);
      chat.controller.abort();
      await chat.done;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("[sma:m_tg_restart] a change in the settings wakes the sync loop at once instead of at its next round, and the chat bridge follows it without a restart of the plugin", async () => {
  const tg = fakeTelegram();
  try {
    const host = await pluginHost({ language: "ru" }, { subscribe: () => () => {} });
    const sync = svc(host, "project-task-sync");
    const getMe = () => tg.calls.filter((c) => c.method === "getMe").length;
    await waitFor(() => getMe() === 1);
    await sleep(100);
    assert.equal(getMe(), 1);
    // The loop sleeps 15 s between rounds: a second round within two seconds can only be the setting change waking it.
    await host.harness.behavior.setSettings({ language: "en" });
    await waitFor(() => getMe() === 2, 2000);
    sync.controller.abort();
    await sync.done;
  } finally {
    for (const run of started.splice(0)) run.controller.abort();
    tg.restore();
  }
  await world(async () => {
    const dir = mkdtempSync(join(tmpdir(), "sma-companion-"));
    try {
      const control = join(dir, "telegram-chat.json");
      const state = () => (existsSync(control) ? (JSON.parse(readFileSync(control, "utf8")) as { enabled: boolean }).enabled : undefined);
      const host = await pluginHost({ chatEnabled: false, companionDir: dir });
      const chat = svc(host, "telegram-chat");
      await waitFor(() => state() === false);
      await host.harness.behavior.setSettings({ chatEnabled: true });
      await waitFor(() => state() === true);
      await host.harness.behavior.setSettings({ enabled: false });
      await waitFor(() => state() === false);
      chat.controller.abort();
      await chat.done;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("[sma:m_tg_non_text] a sticker sent by the owner is answered with a polite refusal in its own topic", async () => {
  await world(async (tg) => {
    const host: Host = await paired();
    tg.script.push([update(1, OWNER, undefined, { sticker: { file_id: "s" }, message_thread_id: 7 }), update(2, OWNER, undefined, { location: { latitude: 1, longitude: 2 } })]);
    await runUntilDrained(host, tg);
    const refusal = "Я читаю текст, голосовые, фото и файлы. Напиши словами, что сделать.";
    assert.deepEqual(tg.sent().map((b) => [b.message_thread_id, b.text]), [[7, refusal], [undefined, refusal]]);
    assert.deepEqual(host.store.keys("chat:in:"), []);
  });
});
