// Stand-in Telegram Bot API and plugin host for the SMA parity proofs (docs/sma-evidence.md «Proofs in a sibling repository»).
// No network: global fetch is replaced while a test runs, timers of the ingress loop are shortened, no real BB CLI is started.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

export const TOKEN = "123456:SMAsecretTOKENabcdefghijklmnop";
export const OWNER = 4242;
export type Call = { method: string; body: any; token: string; deadline: number | undefined };
type Step = any[] | "network" | "html" | { code: number; description: string };

/** A scripted Bot API: getUpdates answers come from `script` in order; when the script is empty the loop under test is stopped. */
export function fakeTelegram() {
  const calls: Call[] = [];
  const script: Step[] = [];
  const timeouts: number[] = [];
  const answers: Record<string, (body: any) => unknown> = {};
  let drained: () => void = () => {};
  let messageId = 100;
  const realFetch = globalThis.fetch;
  const realTimeout = AbortSignal.timeout;
  AbortSignal.timeout = ((ms: number) => {
    timeouts.push(ms);
    return realTimeout.call(AbortSignal, ms);
  }) as typeof AbortSignal.timeout;
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input);
    const m = /\/bot([^/]+)\/(\w+)$/.exec(url);
    if (!m) throw new Error("the stand-in Bot API got a request it does not know: " + url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ method: m[2]!, body, token: m[1]!, deadline: timeouts.at(-1) });
    if (m[2] === "getUpdates") {
      const step = script.shift();
      if (step === undefined) {
        drained();
        return new Promise((_, reject) => {
          const stop = () => reject(new DOMException("aborted", "AbortError"));
          if (init.signal?.aborted) stop();
          else init.signal?.addEventListener("abort", stop, { once: true });
        });
      }
      if (step === "network") throw new TypeError("fetch failed: " + url);
      if (step === "html") return new Response("<html>bad gateway</html>", { status: 502 });
      if (!Array.isArray(step)) return json({ ok: false, error_code: step.code, description: step.description }, step.code);
      return json({ ok: true, result: step });
    }
    const custom = answers[m[2]!];
    const result = custom ? custom(body) : m[2] === "getMe" ? { id: 777, username: "sma_bot", has_topics_enabled: true } : m[2] === "sendMessage" ? { message_id: ++messageId } : true;
    return json({ ok: true, result });
  }) as typeof fetch;
  return {
    calls,
    script,
    answers,
    sent: () => calls.filter((c) => c.method === "sendMessage").map((c) => c.body),
    /** Called once when the loop asks for updates and none are scripted. */
    onDrained(fn: () => void) {
      drained = fn;
    },
    restore() {
      globalThis.fetch = realFetch;
      AbortSignal.timeout = realTimeout;
    },
  };
}

/** Timers of 1 s and more fire after 1 ms; every requested delay is kept, in order. */
export function fastTimers() {
  const delays: number[] = [];
  const real = globalThis.setTimeout;
  (globalThis as any).setTimeout = (fn: any, ms?: number, ...rest: any[]) => {
    delays.push(Number(ms ?? 0));
    return real(fn, (ms ?? 0) >= 1000 ? 1 : ms, ...rest);
  };
  return { delays, restore: () => ((globalThis as any).setTimeout = real) };
}

export type Settings = Record<string, string | number | boolean>;
/** The real plugin on the SDK's fake host, with a stand-in BB CLI path so the Env Catalog is never asked. */
export async function pluginHost(settings: Settings = {}, sdk?: Record<string, unknown>) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "telegram-projects",
    settings: { botToken: TOKEN, enabled: true, cliPath: "/nonexistent/bb", ...settings },
    ...(sdk ? { sdk: sdk as never } : {}),
  });
  await plugin(bb);
  const db = bb.storage.database();
  const store = {
    get: <T>(key: string) => {
      const row = db.prepare("SELECT value FROM state WHERE key=?").get(key) as { value: string } | undefined;
      return row ? (JSON.parse(row.value) as T) : undefined;
    },
    put: (key: string, value: unknown) => {
      db.prepare("INSERT INTO state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
    },
    keys: (prefix = "") => (db.prepare("SELECT key FROM state ORDER BY key").all() as { key: string }[]).map((r) => r.key).filter((k) => k.startsWith(prefix)),
  };
  const rpc = <T = any>(method: string, input: unknown = null) => harness.behavior.callRpc(method, input) as Promise<T>;
  return { bb, harness, store, rpc };
}
export type Host = Awaited<ReturnType<typeof pluginHost>>;

/** Runs a background service until the stand-in API has no more updates to give, then stops it. */
export async function runUntilDrained(host: Host, tg: ReturnType<typeof fakeTelegram>, name = "telegram-ingress") {
  const run = host.harness.behavior.runService(name);
  tg.onDrained(() => run.controller.abort());
  await run.done;
}

export const update = (id: number, from: number, text: string | undefined, extra: Record<string, unknown> = {}) => ({
  update_id: id,
  message: { message_id: id * 10, from: { id: from }, chat: { id: from, type: "private" }, ...(text === undefined ? {} : { text }), ...extra },
});
