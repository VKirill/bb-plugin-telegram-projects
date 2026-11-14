// SMA parity proofs for connecting the bot from the BB window (the plugin's RPC door: saveToken, pairing, unpair, status, preferences) and
// for the Bot API client. The real plugin on the SDK's fake host against a stand-in Bot API (test/sma-support.ts). No network, no hub.
import test from "node:test";
import assert from "node:assert/strict";
import { telegram, readEnvToken } from "../adapters";
import { diagnose } from "../settings";
import { TelegramFailure } from "../model";
import { fakeTelegram, fastTimers, pluginHost, runUntilDrained, update, OWNER, TOKEN } from "./sma-support";

const NEW_TOKEN = "654321:NEWtokenABCDEFGHIJKLMNOPQRSTUV";
async function world(body: (tg: ReturnType<typeof fakeTelegram>) => Promise<void>) {
  const tg = fakeTelegram();
  const timers = fastTimers();
  try {
    await body(tg);
  } finally {
    tg.restore();
    timers.restore();
  }
}
const noToken = (text: string) => assert.ok(!text.includes("SMAsecret") && !text.includes(TOKEN) && !text.includes("NEWtoken") && !text.includes(NEW_TOKEN), "a token came out: " + text.slice(0, 200));
async function withClock<T>(offset: number, body: () => Promise<T>): Promise<T> {
  const real = Date.now;
  Date.now = () => real() + offset;
  try {
    return await body();
  } finally {
    Date.now = real;
  }
}

test("[sma:d_telegram] the window's door «Telegram bot» asks the plugin for the pairing: a new code while nobody is paired, nothing once someone is", async () => {
  await world(async () => {
    const host = await pluginHost();
    const first = await host.rpc("pairing");
    assert.deepEqual(Object.keys(first), ["owner", "code", "link"]);
    assert.equal(first.owner, null);
    assert.match(first.code, /^[A-Z2-9]{8}$/);
    assert.deepEqual(await host.rpc("pairing"), first);
    host.store.put("owner:id", OWNER);
    assert.deepEqual(await host.rpc("pairing"), { owner: OWNER, code: null, link: null });
  });
});

test("[sma:m_tg_connect] the token goes in from the window and never comes out; the window gets a pairing code and can disconnect", async () => {
  await world(async (tg) => {
    tg.answers.getWebhookInfo = () => ({ url: "" });
    const host = await pluginHost({ botToken: "" });
    const outputs: unknown[] = [];
    const before = await host.rpc("preferences");
    assert.equal(before.tokenPresent, false);
    assert.equal(before.tokenSource, "none");
    // Connect: the token is checked with Telegram, then saved.
    const saved = await host.rpc("saveToken", { token: NEW_TOKEN });
    outputs.push(saved);
    assert.equal(saved.valid, true);
    assert.equal(saved.username, "sma_bot");
    const after = await host.rpc("preferences");
    outputs.push(after);
    assert.equal(after.tokenPresent, true);
    assert.equal(after.tokenSource, "manual");
    assert.ok(!("botToken" in after) && !("token" in after));
    // Issue a pairing code, then disconnect.
    await host.rpc("sync");
    const code = await host.rpc("pairing");
    outputs.push(code, await host.rpc("status"));
    assert.match(code.code, /^[A-Z2-9]{8}$/);
    host.store.put("owner:id", OWNER);
    assert.equal(await host.rpc("unpair"), true);
    outputs.push(await host.rpc("status"), await host.rpc("checkConnection", { token: NEW_TOKEN }));
    assert.equal((await host.rpc("status")).owner, null);
    // The only requests that carry the token are the ones to Telegram; nothing the window can read does.
    for (const out of outputs) noToken(JSON.stringify(out));
    assert.ok(tg.calls.length > 0 && tg.calls.every((c) => c.token === NEW_TOKEN));
  });
});

test("[sma:m_tg_pairing_mint] the pairing code has 8 characters without look-alikes, lives ten minutes and is then replaced", async () => {
  await world(async () => {
    const host = await pluginHost();
    const { code } = await host.rpc("pairing");
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    // The same code for nine and a half minutes, a new one after ten.
    assert.equal((await withClock(9.5 * 60_000, () => host.rpc("pairing"))).code, code);
    const renewed = (await withClock(10 * 60_000 + 2000, () => host.rpc("pairing"))).code;
    assert.notEqual(renewed, code);
    // Over many codes: only the alphabet, never 0, O, 1 or I.
    const seen = new Set<string>();
    for (let i = 1; i <= 80; i++) for (const ch of (await withClock(i * 11 * 60_000, () => host.rpc("pairing"))).code) seen.add(ch);
    assert.ok([...seen].every((ch) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".includes(ch)));
    assert.ok(![...seen].some((ch) => "01OI".includes(ch)));
    assert.ok(seen.size > 20);
  });
});

test("[sma:m_tg_link_view] the link the window shows opens the bot with the code and carries no token; once paired the view holds no code at all", async () => {
  await world(async () => {
    const host = await pluginHost();
    await host.rpc("sync");
    const view = await host.rpc("pairing");
    assert.equal(view.link, `https://t.me/sma_bot?start=${view.code}`);
    const status = await host.rpc("status");
    for (const out of [view, status, await host.rpc("preferences")]) noToken(JSON.stringify(out));
    assert.equal(status.bot, "sma_bot");
    host.store.put("owner:id", OWNER);
    assert.deepEqual(await host.rpc("pairing"), { owner: OWNER, code: null, link: null });
    assert.equal((await host.rpc("status")).owner, OWNER);
  });
});

test("[sma:m_tg_link_states] the bot link has three states: off, awaiting the code, linked", async () => {
  await world(async () => {
    const host = await pluginHost({ enabled: false });
    assert.equal((await host.rpc("status")).link, "off");
    await host.harness.behavior.setSettings({ enabled: true });
    assert.equal((await host.rpc("status")).link, "awaiting_code");
    host.store.put("owner:id", OWNER);
    assert.equal((await host.rpc("status")).link, "linked");
    await host.rpc("unpair");
    assert.equal((await host.rpc("status")).link, "awaiting_code");
    host.store.put("owner:id", OWNER);
    await host.harness.behavior.setSettings({ enabled: false });
    assert.equal((await host.rpc("status")).link, "off");
  });
});

test("[sma:m_tg_cfg_connect] connecting writes the token into the bot's own setting only, a token of another bot is refused, and the pairing code is written once and kept", async () => {
  await world(async (tg) => {
    tg.answers.getWebhookInfo = () => ({ url: "" });
    const host = await pluginHost({ botToken: "", language: "en", chatEnabled: true });
    const before = await host.rpc("preferences");
    const { tokenPresent: _a, tokenSource: _b, ...beforeRest } = before;
    assert.equal((await host.rpc("saveToken", { token: NEW_TOKEN })).valid, true);
    const after = await host.rpc("preferences");
    const { tokenPresent, tokenSource, ...afterRest } = after;
    assert.deepEqual([tokenPresent, tokenSource], [true, "manual"]);
    assert.deepEqual(afterRest, beforeRest);
    // A token of a bot other than the one that made the topics is not written.
    host.store.put("bot:id", 1);
    const refused = await host.rpc("saveToken", { token: "999999:OTHERtokenABCDEFGHIJKLMNOPQRST" });
    assert.equal(refused.sameBot, false);
    tg.calls.length = 0;
    await host.rpc("sync").catch(() => {});
    assert.ok(tg.calls.length > 0 && tg.calls.every((c) => c.token === NEW_TOKEN));
    // The code: written once, with its time, and the same code is handed out until it is spent.
    const { code } = await host.rpc("pairing");
    assert.equal(host.store.get("pair:code"), code);
    assert.equal(typeof host.store.get("pair:codeAt"), "number");
    assert.equal((await host.rpc("pairing")).code, code);
  });
});

test("[sma:m_tg_cfg_pair] the paired chat is written only by the code from that chat, and pairing touches no setting", async () => {
  await world(async (tg) => {
    const host = await pluginHost({ language: "en" });
    const prefs = await host.rpc("preferences");
    const { code } = await host.rpc("pairing");
    tg.script.push([update(1, 55, "/start " + code)]);
    await runUntilDrained(host, tg);
    assert.equal(host.store.get("owner:id"), 55);
    assert.deepEqual(await host.rpc("preferences"), prefs);
    // Nothing else a message can say changes who the owner is: the code is spent, and a second chat with it is a stranger.
    tg.script.push([update(2, 56, "/start " + code), update(3, 56, "/start ANYTHING")]);
    await runUntilDrained(host, tg);
    assert.equal(host.store.get("owner:id"), 55);
    assert.equal((await host.rpc("status")).owner, 55);
  });
});

test("[sma:m_tg_cfg_disconnect] disconnecting forgets the paired chat: the link goes back to awaiting a code, the old chat is no longer heard and a new code is offered", async () => {
  await world(async (tg) => {
    const host = await pluginHost({ chatEnabled: true });
    host.store.put("owner:id", OWNER);
    host.store.put("commandsLanguage", "ru");
    assert.equal(await host.rpc("unpair"), true);
    assert.equal(host.store.get("owner:id"), undefined);
    assert.equal(host.store.get("commandsLanguage"), undefined);
    const status = await host.rpc("status");
    assert.deepEqual([status.owner, status.link], [null, "awaiting_code"]);
    const offer = await host.rpc("pairing");
    assert.equal(offer.owner, null);
    assert.match(offer.code, /^[A-Z2-9]{8}$/);
    // The old owner's words are not heard any more: nothing is answered, nothing reaches the conversation.
    tg.script.push([update(1, OWNER, "ты ещё здесь?")]);
    await runUntilDrained(host, tg);
    assert.deepEqual(tg.sent(), []);
    assert.deepEqual(host.store.keys("chat:in:"), []);
  });
});

test("[sma:m_tg_client] the Bot API client posts JSON to the bot's method with the owner's chat on every chat call, none on the bot's own calls, and a deadline of its own", async () => {
  await world(async (tg) => {
    const call = telegram(async () => TOKEN, new AbortController().signal, 12_345, () => OWNER);
    tg.script.push([]);
    await call("getUpdates", { offset: 0, timeout: 25 });
    await call("sendMessage", { text: "hi", message_thread_id: 7 });
    await call("sendMessage", { text: "hey", strangerChatId: 99 });
    await call("sendChatAction", { action: "typing" });
    await call("getMe", {});
    await call("setMyCommands", { commands: [] });
    assert.deepEqual(tg.calls.map((c) => [c.method, c.body, c.token, c.deadline]), [
      ["getUpdates", { offset: 0, timeout: 25 }, TOKEN, 12_345],
      ["sendMessage", { text: "hi", message_thread_id: 7, chat_id: OWNER }, TOKEN, 12_345],
      ["sendMessage", { text: "hey", chat_id: 99 }, TOKEN, 12_345],
      ["sendChatAction", { action: "typing", chat_id: OWNER }, TOKEN, 12_345],
      ["getMe", {}, TOKEN, 12_345],
      ["setMyCommands", { commands: [] }, TOKEN, 12_345],
    ]);
    // A refusal by Telegram arrives as a failure that says how long to wait, and a dead network as a failure that may have gone through.
    const real = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 7 } }), { status: 429 })) as typeof fetch;
      await assert.rejects(call("sendMessage", { text: "x" }), (e: unknown) => e instanceof TelegramFailure && e.code === "telegram_429" && e.retryAfter === 7 && e.ambiguous === false);
      globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, error_code: 502, description: "Bad Gateway" }), { status: 502 })) as typeof fetch;
      await assert.rejects(call("sendMessage", { text: "x" }), (e: unknown) => e instanceof TelegramFailure && e.code === "telegram_502" && e.ambiguous === true);
    } finally {
      globalThis.fetch = real;
    }
  });
});

test("[sma:m_tg_redact] the token never reaches an error: a network failure that names the address, a broken answer and a refusal all become a bare code", async () => {
  await world(async (tg) => {
    const real = globalThis.fetch;
    const call = telegram(async () => TOKEN, new AbortController().signal);
    const leaks = (e: unknown) => {
      const text = [String(e), (e as Error).message, (e as Error).stack ?? "", JSON.stringify(e), JSON.stringify(Object.entries(e as object))].join("\n");
      return text.includes("SMAsecret") || text.includes(TOKEN);
    };
    try {
      globalThis.fetch = (async (url: unknown) => {
        throw new TypeError(`fetch failed: request to ${String(url)} failed, reason: connect ECONNREFUSED`);
      }) as typeof fetch;
      await assert.rejects(call("getMe", {}), (e: unknown) => e instanceof TelegramFailure && e.code === "telegram_network" && !leaks(e));
      globalThis.fetch = (async () => new Response("<html>" + TOKEN + "</html>", { status: 502 })) as typeof fetch;
      await assert.rejects(call("getMe", {}), (e: unknown) => e instanceof TelegramFailure && e.code === "telegram_invalid_response" && !leaks(e));
      globalThis.fetch = (async (url: unknown) => new Response(JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized " + String(url) }), { status: 401 })) as typeof fetch;
      await assert.rejects(call("getMe", {}), (e: unknown) => e instanceof TelegramFailure && e.code === "telegram_401" && !leaks(e));
      // The check the window runs with a typed token reports a bare code too.
      globalThis.fetch = (async (url: unknown) => {
        throw new TypeError("fetch failed: " + String(url));
      }) as typeof fetch;
      const diagnosis = await diagnose(TOKEN);
      assert.equal(diagnosis.error, "telegram_check_failed");
      noToken(JSON.stringify(diagnosis));
      // The Env Catalog reader gives up silently: an unusable CLI path leaves no message behind.
      assert.equal(await readEnvToken("/nonexistent/bb", "http://127.0.0.1:1", "TELEGRAM_BOT_TOKEN", new AbortController().signal), "");
    } finally {
      globalThis.fetch = real;
    }
    // In the plugin: what the loop writes about a failed poll, and what the window reads back, holds the code only.
    const host = await pluginHost();
    tg.script.push("network");
    await runUntilDrained(host, tg);
    const status = await host.rpc("status");
    assert.equal(status.ingressError, "telegram_network");
    noToken(JSON.stringify(status));
  });
});
