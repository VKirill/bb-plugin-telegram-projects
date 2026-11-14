// The chat bridge on a stand-in BB (the shape test/chat.test.ts uses): one project topic 100, one thread. For the SMA parity proofs.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatBridge, type ChatInput } from "../chat";
import type { Store } from "../model";

export const OWNER_ID = 4242;

export function bridgeFixture(options: { confirmNewChat?: boolean } = {}) {
  const data = new Map<string, unknown>();
  const calls: Array<[string, any]> = [];
  const sent: any[] = [];
  let message = 10;
  const thread: Record<string, unknown> = {
    id: "thr_one", projectId: "proj_one", title: "Первый чат", status: "idle", providerId: "codex", visibility: "visible",
    environmentId: "env_one", archivedAt: null, deletedAt: null,
  };
  const store: Store = {
    get: (k) => structuredClone(data.get(k)) as never,
    put: (k, v) => void data.set(k, structuredClone(v)),
    del: (k) => void data.delete(k),
    list: (p) => [...data].filter(([k]) => k.startsWith(p)).map(([key, value]) => ({ key, value: structuredClone(value) as never })),
    atomic: (f) => f(),
  };
  store.put("topic:proj_one", { key: "proj_one", name: "Проект", threadId: 100 });
  const sdk: any = {
    projects: { list: async () => [{ id: "proj_one", name: "Проект", kind: "standard" }], get: async () => ({ id: "proj_one", name: "Проект" }) },
    environments: { get: async () => ({ path: "/work/project" }) },
    providers: { list: async () => [{ id: "codex", displayName: "Codex", available: true }], models: async () => ({ models: [], modelLoadError: null }) },
    plugins: { list: async () => ({ plugins: [] }), callRpc: async () => ({ folders: [], roots: [] }) },
    threads: {
      defaultExecutionOptions: async () => ({ model: "model-a" }),
      get: async ({ threadId }: any) => ({ ...thread, id: threadId }),
      list: async () => [thread],
      spawn: async (a: any) => { calls.push(["spawn", a]); return thread; },
      send: async (a: any) => { calls.push(["send", a]); },
      stop: async (a: any) => calls.push(["stop", a]),
      update: async (a: any) => calls.push(["update", a]),
      output: async () => ({ output: "" }),
      events: { list: async (a: any) => (a.order === "desc" ? [{ seq: 1 }] : []) },
      interactions: { list: async () => [], get: async () => undefined, resolve: async () => {} },
    },
  };
  const dir = mkdtempSync(join(tmpdir(), "bb-sma-chat-"));
  const bridge = new ChatBridge({
    store, sdk, spool: dir, owner: () => OWNER_ID, baseUrl: "https://bb.example", signal: new AbortController().signal, rich: () => false,
    confirmNewChat: () => options.confirmNewChat === true,
    tg: async (method, payload) => { sent.push({ method, ...payload }); return { message_id: ++message } as never; },
  });
  let n = 0;
  const input = (text: string | undefined, topicId = 100): ChatInput => ({ ownerId: OWNER_ID, chatId: OWNER_ID, topicId, messageId: ++n, updateId: ++n, text });
  return { bridge, calls, sent, thread, input, data, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
