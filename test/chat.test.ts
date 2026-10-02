import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatBridge, inputSchema, splitText, type ChatInput } from "../chat";
import { TelegramFailure, type Store } from "../model";
const OWNER_ID = 259034221;
function fixture() {
  const data = new Map<string, any>();
  const calls: any[] = [];
  const sent: any[] = [];
  let message = 10;
  let failDelivery = false;
  let events: any[] = [];
  let interactions: any[] = [];
  const thread = {
    id: "thr_one",
    projectId: "proj_one",
    title: "Первый чат",
    status: "idle",
    providerId: "codex",
    visibility: "visible",
    environmentId: "env_one",
    archivedAt: null,
    deletedAt: null,
  };
  const store: Store = {
    get: (k) => structuredClone(data.get(k)),
    put: (k, v) => data.set(k, structuredClone(v)),
    del: (k) => {
      data.delete(k);
    },
    list: (p) =>
      [...data]
        .filter(([k]) => k.startsWith(p))
        .map(([key, value]) => ({ key, value: structuredClone(value) })),
    atomic: (f) => f(),
  };
  store.put("topic:proj_one", {
    key: "proj_one",
    name: "Проект",
    threadId: 100,
  });
  const sdk: any = {
    projects: {
      list: async () => [{ id: "proj_one", name: "Проект", kind: "standard" }],
      get: async () => ({ id: "proj_one", name: "Проект" }),
    },
    environments: { get: async () => ({ path: "/work/project" }) },
    providers: {
      list: async () => [
        { id: "codex", displayName: "Codex", available: true },
      ],
      models: async () => ({
        models: [{ model: "model-a", displayName: "Модель A" }],
        modelLoadError: null,
      }),
    },
    plugins: {
      list: async () => ({ plugins: [] }),
      callRpc: async () => ({
        folders: [
          {
            id: "folder",
            projectId: "proj_one",
            hostId: "mini",
            parentId: null,
            name: "Раздел",
            path: "/work/project/section",
          },
        ],
        roots: [],
      }),
    },
    threads: {
      defaultExecutionOptions: async () => ({ model: "model-a" }),
      get: async ({ threadId }: any) => ({ ...thread, id: threadId }),
      list: async () => [thread],
      spawn: async (a: any) => {
        calls.push(["spawn", a]);
        return thread;
      },
      send: async (a: any) => {
        calls.push(["send", a]);
      },
      stop: async (a: any) => calls.push(["stop", a]),
      update: async (a: any) => calls.push(["update", a]),
      output: async () => ({ output: "Ответ из BB" }),
      events: {
        list: async (a: any) =>
          a.order === "desc"
            ? [{ seq: 99 }]
            : events.filter((e) => e.seq > Number(a.afterSeq)),
      },
      interactions: {
        list: async () => interactions,
        get: async ({ interactionId }: any) =>
          interactions.find((i) => i.id === interactionId),
        resolve: async (a: any) => {
          calls.push(["resolve", a]);
          interactions[0].status = "resolved";
        },
      },
    },
  };
  const dir = mkdtempSync(join(tmpdir(), "bb-chat-test-"));
  const bridge = new ChatBridge({
    store,
    sdk,
    tg: async (method, payload) => {
      if (failDelivery) {
        failDelivery = false;
        throw new TelegramFailure("telegram_429", 20, false);
      }
      sent.push({ method, ...payload });
      return { message_id: ++message } as any;
    },
    spool: dir,
    owner: () => OWNER_ID,
    baseUrl: "https://bb.example",
    signal: new AbortController().signal,
    rich: () => false,
  });
  let update = 0;
  const input = (text: string, topicId = 100): ChatInput => ({
    ownerId: OWNER_ID,
    chatId: OWNER_ID,
    topicId,
    messageId: ++update,
    updateId: update,
    text,
  });
  const press = async (kind: string) => {
    const action = [...data]
      .reverse()
      .find(([k, v]) => k.startsWith("chat:button:") && v.kind === kind);
    assert.ok(action, "button " + kind);
    await bridge.handle({
      ...input(""),
      callback: "bb:" + action[0].slice("chat:button:".length),
    });
  };
  return {
    data,
    store,
    calls,
    sent,
    sdk,
    thread,
    bridge,
    input,
    press,
    failNextDelivery: () => {
      failDelivery = true;
    },
    setEvents: (v: any[]) => {
      events = v;
    },
    setQuestions: (v: any[]) => {
      interactions = v;
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
test("new message creates visible BB chat; subsequent message reuses it", async () => {
  const f = fixture();
  try {
    await f.bridge.handle(f.input("Первый запрос"));
    await f.bridge.handle(f.input("Продолжим"));
    assert.equal(f.calls[0][0], "spawn");
    assert.equal(f.calls[0][1].visibility, "visible");
    assert.deepEqual(f.calls[0][1].environment, { type: "project-default" });
    assert.equal(f.calls[1][0], "send");
    assert.equal(f.calls[1][1].threadId, "thr_one");
  } finally {
    f.cleanup();
  }
});
test("custom Telegram topic can bind a project before sending", async () => {
  const f = fixture();
  try {
    await f.bridge.handle(f.input("/project", 777));
    const [key] = [...f.data].find(
      ([k, v]) => k.startsWith("chat:button:") && v.kind === "project",
    )!;
    await f.bridge.handle({
      ...f.input("", 777),
      callback: "bb:" + key.slice(12),
    });
    await f.bridge.handle(f.input("Из новой темы", 777));
    assert.equal(f.calls[0][1].projectId, "proj_one");
    assert.equal(
      f.bridge.bindings().find((x) => x.topicId === 777)?.threadId,
      "thr_one",
    );
  } finally {
    f.cleanup();
  }
});
test("foreign identity rejected at ingress", () => {
  const f = fixture();
  try {
    assert.throws(() => f.bridge.accept({ ...f.input("hi"), ownerId: 22 }));
    assert.equal(f.data.size, 1);
  } finally {
    f.cleanup();
  }
});
test("new chat and disconnect never delete or stop original", async () => {
  const f = fixture();
  try {
    await f.bridge.handle(f.input("hello"));
    await f.bridge.handle(f.input("/new"));
    assert.equal(f.bridge.bindings()[0].threadId, null);
    await f.bridge.handle(f.input("/disconnect"));
    await f.bridge.handle(f.input("must not send"));
    assert.equal(f.calls.length, 1);
  } finally {
    f.cleanup();
  }
});
test("connecting an existing chat baselines old events and rejects stale controls", async () => {
  const f = fixture();
  try {
    await f.bridge.handle(f.input("/chats"));
    await f.press("inspect");
    const button = [...f.data].find(
      ([k, v]) => k.startsWith("chat:button:") && v.kind === "connect",
    )!;
    await f.press("connect");
    assert.equal(f.bridge.bindings()[0].cursor, 99);
    await f.bridge.handle({
      ...f.input(""),
      callback: "bb:" + button[0].slice(12),
    });
    assert.equal(f.calls.length, 0);
    assert.ok([...f.data.values()].some((v) => v.text?.includes("устарела")));
  } finally {
    f.cleanup();
  }
});
test("stop requires a specific confirmation", async () => {
  const f = fixture();
  try {
    await f.bridge.handle(f.input("hello"));
    await f.bridge.handle(f.input("/stop"));
    assert.equal(f.calls.length, 1);
    await f.press("stop");
    assert.equal(f.calls[1][0], "stop");
  } finally {
    f.cleanup();
  }
});
test("section choice sets exact host and folder for native spawn", async () => {
  const f = fixture();
  try {
    await f.bridge.handle(f.input("/section"));
    const entry = [...f.data].find(
      ([k, v]) =>
        k.startsWith("chat:button:") &&
        v.kind === "folder" &&
        v.arg === "folder",
    )!;
    await f.bridge.handle({
      ...f.input(""),
      callback: "bb:" + entry[0].slice(12),
    });
    await f.bridge.handle(f.input("Run"));
    assert.deepEqual(f.calls[0][1].environment, {
      type: "host",
      hostId: "mini",
      workspace: { type: "unmanaged", path: "/work/project/section" },
    });
  } finally {
    f.cleanup();
  }
});
test("model menu uses BB catalog and does not alter other chats", async () => {
  const f = fixture();
  try {
    await f.bridge.handle(f.input("/model"));
    const p = [...f.data].find(
      ([k, v]) =>
        k.startsWith("chat:button:") &&
        v.kind === "provider" &&
        v.arg === "codex",
    )!;
    await f.bridge.handle({ ...f.input(""), callback: "bb:" + p[0].slice(12) });
    await f.press("model");
    await f.bridge.handle(f.input("Run"));
    assert.equal(f.calls[0][1].model, "model-a");
    assert.equal(f.calls[0][1].providerId, "codex");
  } finally {
    f.cleanup();
  }
});
test("only final agent text sent once, not tool commentary or previous turns", async () => {
  const f = fixture();
  try {
    await f.bridge.handle(f.input("Run"));
    f.setEvents([
      {
        seq: 1,
        type: "item/completed",
        scope: { kind: "turn", turnId: "turn" },
        data: { item: { type: "agentMessage", text: "Проверяю" } },
      },
      {
        seq: 2,
        type: "item/completed",
        scope: { kind: "turn", turnId: "turn" },
        data: { item: { type: "agentMessage", text: "Готовый ответ" } },
      },
      {
        seq: 3,
        type: "turn/completed",
        scope: { kind: "turn", turnId: "turn" },
        data: { status: "completed" },
      },
    ]);
    await f.bridge.observe();
    await f.bridge.observe();
    await f.bridge.flush();
    assert.equal(f.sent.filter((x) => x.text === "Готовый ответ").length, 1);
    assert.equal(f.sent.filter((x) => x.text === "Проверяю").length, 0);
  } finally {
    f.cleanup();
  }
});
test("queued answer from old binding never enters new conversation", async () => {
  const f = fixture();
  try {
    await f.bridge.handle(f.input("Run"));
    f.setEvents([
      {
        seq: 1,
        type: "item/completed",
        scope: { kind: "turn", turnId: "turn" },
        data: { item: { type: "agentMessage", text: "Старый ответ" } },
      },
      {
        seq: 2,
        type: "turn/completed",
        scope: { kind: "turn", turnId: "turn" },
        data: { status: "completed" },
      },
    ]);
    await f.bridge.observe();
    await f.bridge.handle(f.input("/new"));
    await f.bridge.flush();
    assert.equal(f.sent.filter((x) => x.text === "Старый ответ").length, 0);
  } finally {
    f.cleanup();
  }
});
test("duplicate accepted update and recovery never replay unknown mutation", () => {
  const f = fixture();
  try {
    const input = f.input("Run");
    f.bridge.accept(input);
    f.bridge.accept(input);
    assert.equal(f.store.list("chat:in:").length, 1);
    f.store.put("chat:in:" + input.updateId, {
      input,
      state: "claimed",
      at: Date.now(),
    });
    f.bridge.recover();
    assert.equal(f.store.get<any>("chat:in:" + input.updateId).state, "done");
    assert.equal(f.calls.length, 0);
  } finally {
    f.cleanup();
  }
});
test("approval callback resolves once; later stale tap does not execute again", async () => {
  const f = fixture();
  try {
    await f.bridge.handle(f.input("Run"));
    f.setQuestions([
      {
        id: "ask",
        status: "pending",
        payload: {
          kind: "approval",
          reason: "Команда",
          subject: { kind: "command", command: "ls" },
          availableDecisions: ["allow_once", "deny"],
        },
      },
    ]);
    await f.bridge.observe();
    await f.press("resolve");
    assert.equal(f.calls.filter((x) => x[0] === "resolve").length, 1);
    await f.press("resolve");
    assert.equal(f.calls.filter((x) => x[0] === "resolve").length, 1);
  } finally {
    f.cleanup();
  }
});
test("pending BB question prevents normal text from steering past it", async () => {
  const f = fixture();
  try {
    await f.bridge.handle(f.input("Run"));
    f.setQuestions([
      {
        id: "ask",
        status: "pending",
        payload: { kind: "plugin", title: "Form" },
      },
    ]);
    await f.bridge.handle(f.input("yes"));
    assert.equal(f.calls.length, 1);
  } finally {
    f.cleanup();
  }
});
test("long text splitting preserves content and surrogate pairs", () => {
  const text = "a".repeat(3499) + "😀" + "b".repeat(4000);
  const chunks = splitText(text);
  assert.equal(chunks.join(""), text);
  assert.ok(
    chunks.every((x) => x.length <= 3500 && !/[\uD800-\uDBFF]$/.test(x)),
  );
});

test("progress edits its previous card instead of adding a new one", async () => {
  const f = fixture();
  try {
    await f.bridge.handle(f.input("Run"));
    await f.bridge.observe();
    await f.bridge.flush();
    f.thread.status = "error";
    await f.bridge.observe();
    await f.bridge.flush();
    assert.equal(
      f.sent.filter((x) => x.method === "editMessageText").length,
      1,
    );
  } finally {
    f.cleanup();
  }
});
test("429 retains message and confirmed receipts avoid replay", async () => {
  const f = fixture();
  try {
    await f.bridge.handle(f.input("/menu"));
    const entry = f.store.list<any>("chat:out:")[0];
    f.failNextDelivery();
    await f.bridge.flush();
    assert.equal(f.sent.length, 0);
    assert.equal(f.store.get<any>(entry.key).error, "telegram_429");
    await f.bridge.flush();
    assert.equal(f.sent.length, 0);
    f.store.put(entry.key, { ...entry.value, retryAt: 0 });
    await f.bridge.flush();
    await f.bridge.flush();
    assert.equal(f.sent.length, 1);
  } finally {
    f.cleanup();
  }
});
test("free text answers exact pending question; closed question never reopens", async () => {
  const f = fixture();
  try {
    await f.bridge.handle(f.input("Run"));
    const q = {
      id: "q",
      status: "pending",
      payload: {
        kind: "user_question",
        questions: [
          {
            id: "q1",
            prompt: "Ответ?",
            allowFreeText: true,
            multiSelect: false,
            options: [],
          },
        ],
      },
    };
    f.setQuestions([q]);
    await f.bridge.observe();
    await f.bridge.flush();
    const record = f.store.list<any>("chat:question:")[0];
    assert.ok(record);
    const replyTo = Number(record.key.split(":").at(-1));
    await f.bridge.handle({ ...f.input("Мой ответ"), replyTo });
    assert.equal(f.calls.filter((x) => x[0] === "resolve").length, 1);
    assert.equal(f.calls.at(-1)[1].resolution.answers.q1.freeText, "Мой ответ");
    await f.bridge.handle({ ...f.input("Ещё ответ"), replyTo });
    assert.equal(f.calls.filter((x) => x[0] === "resolve").length, 1);
  } finally {
    f.cleanup();
  }
});

test("folder button hides host path; callback menu edits original card", async () => {
  const f = fixture();
  try {
    await f.bridge.handle(f.input("/section"));
    await f.bridge.flush();
    const labels = f.sent
      .at(-1)
      .reply_markup.inline_keyboard.flat()
      .map((b: any) => b.text);
    assert.ok(
      labels.every((s: string) => !s.includes("/")),
      JSON.stringify(labels),
    );
    const action = [...f.data]
      .reverse()
      .find(([k, v]) => k.startsWith("chat:button:") && v.kind === "menu")!;
    await f.bridge.handle({
      ...f.input(""),
      messageId: 12345,
      callback: "bb:" + action[0].slice(12),
    });
    await f.bridge.flush();
    assert.equal(f.sent.at(-1).method, "editMessageText");
    assert.equal(f.sent.at(-1).message_id, 12345);
  } finally {
    f.cleanup();
  }
});

test("CLI profile selection follows model and travels only in initial native prompt", async () => {
  const f = fixture();
  try {
    f.sdk.projects.get = async () => ({
      id: "proj_one",
      name: "Проект",
      sources: [{ hostId: "host_one", path: "/work/project", isDefault: true }],
    });
    f.sdk.plugins.list = async () => ({
      plugins: [{ id: "cli-agents", status: "running" }],
    });
    const previous = f.sdk.plugins.callRpc;
    f.sdk.plugins.callRpc = async (a: any) => {
      if (a.pluginId !== "cli-agents") return previous(a);
      if (a.method === "catalog")
        return {
          supported: true,
          warnings: [],
          agents: [{ id: "reviewer", description: "Review" }],
        };
      assert.equal(a.input.hostId, "host_one");
      assert.equal(a.input.projectId, "proj_one");
      assert.equal(a.input.agentId, "reviewer");
      return {
        token: "11111111-1111-4111-8111-111111111111",
        label: "Agent: reviewer",
      };
    };
    await f.bridge.handle(f.input("/model"));
    await f.press("provider");
    await f.press("model");
    assert.ok(
      [...f.data.values()].some(
        (v) => v.kind === "profile" && v.arg === "reviewer",
      ),
    );
    const reviewer = [...f.data].find(
      ([k, v]) =>
        k.startsWith("chat:button:") &&
        v.kind === "profile" &&
        v.arg === "reviewer",
    )!;
    await f.bridge.handle({
      ...f.input(""),
      callback: "bb:" + reviewer[0].slice(12),
    });
    await f.bridge.flush();
    assert.ok(f.sent.at(-1).text.includes("🎭 Профиль: reviewer"));
    assert.ok(f.sent.at(-1).text.includes("🧠 Модель: Модель A"));
    assert.ok(
      !f.sent
        .at(-1)
        .reply_markup.inline_keyboard.flat()
        .some((b: any) => b.text.includes("Остановить")),
    );
    await f.bridge.handle(f.input("Check this"));
    assert.equal(
      f.calls[0][1].prompt,
      "[cli-agents-selection:11111111-1111-4111-8111-111111111111]\nCheck this",
    );
    assert.equal(f.calls[0][1].model, "model-a");
    await f.bridge.handle(f.input("Next"));
    assert.equal(f.calls[1][1].input[0].text, "Next");
  } finally {
    f.cleanup();
  }
});

test("profile pages show eight agents, paired buttons, bounded navigation and default", async () => {
  const f = fixture();
  try {
    f.sdk.projects.get = async () => ({
      id: "proj_one",
      name: "Project",
      sources: [{ hostId: "host_one", path: "/work", isDefault: true }],
    });
    f.sdk.plugins.list = async () => ({
      plugins: [{ id: "cli-agents", status: "running" }],
    });
    f.sdk.plugins.callRpc = async () => ({
      supported: true,
      warnings: [],
      agents: Array.from({ length: 19 }, (_, i) => ({
        id: "role-" + i,
        description: "",
      })),
    });
    await f.bridge.handle(f.input("/model"));
    await f.press("provider");
    await f.press("model");
    await f.bridge.flush();
    const buttons = () => f.sent.at(-1).reply_markup.inline_keyboard;
    assert.deepEqual(
      buttons()
        .slice(0, 4)
        .map((r: any) => r.length),
      [2, 2, 2, 2],
    );
    assert.ok(f.sent.at(-1).text.includes("1 / 3"));
    assert.ok(!JSON.stringify(buttons()).includes("role-8"));
    const clickNext = async () => {
      const next = [...f.data]
        .reverse()
        .find(
          ([k, v]) =>
            k.startsWith("chat:button:") &&
            v.kind === "profiles" &&
            v.arg === String(f.sent.at(-1).text.includes("1 / 3") ? 8 : 16),
        );
      assert.ok(next);
      await f.bridge.handle({
        ...f.input(""),
        callback: "bb:" + next[0].slice(12),
      });
      await f.bridge.flush();
    };
    await clickNext();
    assert.ok(f.sent.at(-1).text.includes("2 / 3"));
    assert.equal(buttons()[0][0].text, "role-8");
    await clickNext();
    assert.ok(f.sent.at(-1).text.includes("3 / 3"));
    assert.equal(buttons()[0][0].text, "role-16");
    assert.ok(
      !buttons()
        .flat()
        .some((b: any) => b.text.includes("Далее")),
    );
    assert.ok(
      buttons()
        .flat()
        .some((b: any) => b.text === "По умолчанию BB"),
    );
  } finally {
    f.cleanup();
  }
});

test("Projects & Sections target is passed to CLI Agents; absent CLI Agents skips picker", async () => {
  const f = fixture();
  try {
    f.sdk.plugins.list = async () => ({
      plugins: [
        { id: "project-folders", status: "running" },
        { id: "cli-agents", status: "running" },
      ],
    });
    f.sdk.environments.list = async () => [
      {
        id: "env_section",
        hostId: "mini",
        projectId: "proj_one",
        path: "/work/project/section",
      },
    ];
    const original = f.sdk.plugins.callRpc;
    let seen: any;
    f.sdk.plugins.callRpc = async (a: any) => {
      if (a.pluginId === "project-folders") return original(a);
      seen = a.input;
      return {
        supported: true,
        warnings: [],
        agents: [{ id: "section-role", description: "" }],
      };
    };
    await f.bridge.handle(f.input("/section"));
    const section = [...f.data].find(
      ([k, v]) =>
        k.startsWith("chat:button:") &&
        v.kind === "folder" &&
        v.arg === "folder",
    )!;
    await f.bridge.handle({
      ...f.input(""),
      callback: "bb:" + section[0].slice(12),
    });
    await f.bridge.handle(f.input("/model"));
    await f.press("provider");
    await f.press("model");
    await f.bridge.flush();
    assert.equal(seen.hostId, "mini");
    assert.equal(seen.environmentId, "env_section");
    assert.equal(seen.cwd, "/work/project/section");
    assert.ok(f.sent.at(-1).text.includes("Выбери профиль"));
    f.sdk.plugins.list = async () => ({
      plugins: [{ id: "project-folders", status: "running" }],
    });
    seen = null;
    await f.bridge.handle(f.input("/model"));
    await f.press("provider");
    await f.press("model");
    await f.bridge.flush();
    assert.equal(seen, null);
    assert.ok(f.sent.at(-1).text.includes("Напиши первое сообщение"));
    assert.ok(!f.sent.at(-1).text.includes("Выбери профиль"));
  } finally {
    f.cleanup();
  }
});

test("server selection routes catalogs and new chat to that project's remote source", async () => {
  const f = fixture();
  try {
    f.sdk.hosts = {
      list: async () => [{ id: "ovh", name: "OVH", status: "connected" }],
      get: async () => ({ id: "ovh", name: "OVH", status: "connected" }),
    };
    f.sdk.projects.get = async () => ({
      id: "proj_one",
      sources: [{ hostId: "ovh", path: "/srv/project", isDefault: false }],
    });
    const routes: any[] = [];
    f.sdk.providers.list = async (a: any) => {
      routes.push(a);
      return [{ id: "codex", displayName: "Codex", available: true }];
    };
    await f.bridge.handle(f.input("/server"));
    await f.press("host");
    await f.press("provider");
    await f.press("model");
    await f.bridge.handle(f.input("Hello remote"));
    const spawn = f.calls.find((c) => c[0] === "spawn")[1];
    assert.deepEqual(spawn.environment, {
      type: "host",
      hostId: "ovh",
      workspace: { type: "unmanaged", path: "/srv/project" },
    });
    assert.ok(routes.some((r) => r.hostId === "ovh"));
  } finally {
    f.cleanup();
  }
});

test("empty native profile catalog explains fallback after model selection", async () => {
  const f = fixture();
  try {
    f.sdk.projects.get = async () => ({
      id: "proj_one",
      sources: [{ hostId: "mini", path: "/work/project", isDefault: true }],
    });
    f.sdk.plugins.list = async () => ({
      plugins: [{ id: "cli-agents", status: "running" }],
    });
    f.sdk.plugins.callRpc = async () => ({
      supported: true,
      agents: [],
      warnings: [],
    });
    await f.bridge.handle(f.input("/model"));
    await f.press("provider");
    await f.press("model");
    await f.bridge.flush();
    assert.ok(f.sent.at(-1).text.includes("профили не найдены"));
  } finally {
    f.cleanup();
  }
});
