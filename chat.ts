import { AsyncLocalStorage } from "node:async_hooks";
import { translate, type Language } from "./companion/aivech/src/locale";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  lstatSync,
} from "node:fs";
import { join } from "node:path";
import {
  OWNER_ID,
  type Store,
  type Topic,
  type Telegram,
  TelegramFailure,
} from "./model";

type PendingInteraction = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["interactions"]["get"]>
>;
type CreateThreadEnvironmentArgs = Parameters<
  BbPluginApi["sdk"]["threads"]["spawn"]
>[0]["environment"];
export const inputSchema = z.object({
  updateId: z.number().int().nonnegative(),
  ownerId: z.literal(OWNER_ID),
  chatId: z.literal(OWNER_ID),
  topicId: z.number().int().nonnegative(),
  messageId: z.number().int(),
  text: z.string().max(16000).optional(),
  callback: z.string().max(64).optional(),
  replyTo: z.number().int().optional(),
  voice: z
    .object({
      fileId: z.string().max(512),
      mime: z.string().max(80),
      size: z.number().nonnegative(),
      duration: z.number().nonnegative(),
    })
    .optional(),
});
export type ChatInput = z.infer<typeof inputSchema>;
type Binding = {
  topicId: number;
  projectId: string;
  threadId: string | null;
  revision: string;
  ready: boolean;
  cursor: number;
  folderId?: string;
  hostId?: string;
  providerId?: string;
  model?: string;
  profileId?: string;
  profileTarget?: { hostId: string; environmentId: string | null; cwd: string };
  activity?: string;
  status?: string;
  progressId?: number;
  progressText?: string;
  lastProgress?: number;
};
type Action = {
  topicId: number;
  revision: string;
  kind: string;
  arg?: string;
  extra?: string;
  expires: number;
  used?: boolean;
};
type Inbox = {
  input: ChatInput;
  state: "pending" | "claimed" | "done";
  at: number;
};
type Outbox = {
  revision?: string;
  topicId: number;
  text: string;
  keys?: Key[][];
  rich?: boolean;
  editId?: number;
  sentId?: number;
  retryAt: number;
  at: number;
  error?: string;
};
type Key = { text: string; callback_data?: string; url?: string };
const folderSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  hostId: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  path: z.string(),
});
const foldersSchema = z.object({
  folders: z.array(folderSchema),
  roots: z.array(folderSchema),
});
const fresh = () => randomBytes(10).toString("hex");
const label = (s: string, n = 55) =>
  s.replace(/[\u0000-\u001f]/g, " ").slice(0, n);
export const splitText = (text: string, limit = 3500) => {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length) {
    let n = rest.length > limit ? rest.lastIndexOf("\n", limit) : rest.length;
    if (n < limit / 2) n = Math.min(limit, rest.length);
    if (n < rest.length && /[\uD800-\uDBFF]/.test(rest[n - 1])) n--;
    chunks.push(rest.slice(0, n));
    rest = rest.slice(n).replace(/^\n/, "");
  }
  return chunks;
};
const states: Record<string, string> = {
  idle: "готов к сообщению",
  active: "выполняется",
  starting: "запускается",
  pending: "ожидает запуска",
  stopping: "останавливается",
  error: "ошибка",
};

export class ChatBridge {
  private tr = (s: string) => translate(this.d.language?.() ?? "ru", s);
  private navigation = new AsyncLocalStorage<{
    topicId: number;
    messageId: number;
  }>();
  private nextObserve = 0;
  private lanes = new Set<number>();
  private disposed = false;
  private lastError: string | null = null;
  private work = new Set<Promise<void>>();
  private observed = false;
  private flushing = false;
  constructor(
    private d: {
      store: Store;
      sdk: BbPluginApi["sdk"];
      tg: Telegram;
      spool: string;
      baseUrl: string;
      signal: AbortSignal;
      wake?: () => void;
      language?: () => Language;
      rich: () => boolean;
      transcribe?: (v: NonNullable<ChatInput["voice"]>) => Promise<string>;
    },
  ) {}
  private get s() {
    return this.d.store;
  }
  forget(topicId: number) {
    this.s.del("chat:binding:" + topicId);
  }
  bindings() {
    return this.s.list<Binding>("chat:binding:").map((x) => x.value);
  }
  private save(b: Binding) {
    this.s.put("chat:binding:" + b.topicId, b);
  }
  private binding(topicId: number): Binding | undefined {
    const old = this.s.get<Binding>("chat:binding:" + topicId);
    if (old) return old;
    const topic = this.s
      .list<Topic>("topic:")
      .find(
        (x) =>
          x.value.threadId === topicId &&
          x.value.key.startsWith("proj_") &&
          !x.value.missingSince,
      )?.value;
    if (!topic) return;
    const b: Binding = {
      topicId,
      projectId: topic.key,
      threadId: null,
      revision: fresh(),
      ready: true,
      cursor: 0,
    };
    this.save(b);
    return b;
  }
  private button(
    b: Binding,
    kind: string,
    text: string,
    arg?: string,
    extra?: string,
  ): Key {
    const id = fresh();
    this.s.put("chat:button:" + id, {
      topicId: b.topicId,
      revision: b.revision,
      kind,
      arg,
      extra,
      expires: Date.now() + 86400_000,
    } satisfies Action);
    return { text, callback_data: "bb:" + id };
  }
  /** One tap on an agent report connects that thread to the report's topic. */
  connectButton(topicId: number, threadId: string): Key | undefined {
    const b = this.binding(topicId);
    if (!b || b.threadId === threadId) return;
    return this.button(b, "connect", this.tr("🔌 Подключить здесь"), threadId);
  }
  private nav(b: Binding): Key[][] {
    return [
      [
        this.button(b, "new", this.tr("✚ Новый чат")),
        this.button(b, "sessions", this.tr("💬 Чаты")),
      ],
      [
        this.button(b, "menu", this.tr("📍 Текущий")),
        this.button(b, "history", this.tr("📖 Последний ответ")),
      ],
      [
        this.button(b, "folders", this.tr("📁 Раздел")),
        this.button(b, "providers", this.tr("🤖 Агент / модель")),
      ],
      ...(b.threadId
        ? [
            [
              this.button(b, "stopConfirm", this.tr("⏹ Остановить")),
              this.button(b, "disconnect", this.tr("Отключиться")),
            ],
          ]
        : []),
      ...(b.threadId
        ? []
        : [
            [
              this.button(b, "hosts", this.tr("🖥 Сервер")),
              this.button(b, "profiles", this.tr("🎭 Профиль")),
            ],
          ]),
      [this.button(b, "projects", this.tr("📂 Все проекты"))],
    ];
  }
  private enqueue(
    topicId: number,
    text: string,
    keys?: Key[][],
    id = fresh(),
    rich = false,
    editId?: number,
  ) {
    const context = this.navigation.getStore();
    if (
      !editId &&
      keys &&
      context?.topicId === topicId &&
      !/^(event|end|question|progress):/.test(id)
    )
      editId = context.messageId;
    const key = "chat:out:" + id;
    if (this.s.get(key)) return;
    this.s.put(key, {
      topicId,
      text,
      keys,
      rich,
      editId,
      revision: /^(event|end|question|progress):/.test(id)
        ? id.split(":")[1]
        : undefined,
      retryAt: 0,
      at: Date.now(),
    } satisfies Outbox);
    this.d.wake?.();
  }
  private link(threadId: string): Key {
    return {
      text: this.tr("Открыть чат в BB"),
      url:
        this.d.baseUrl +
        "/projects/" +
        encodeURIComponent(
          this.bindings().find((b) => b.threadId === threadId)?.projectId ??
            this.s.get<string>("chat:thread-project:" + threadId) ??
            "",
        ) +
        "/threads/" +
        encodeURIComponent(threadId),
    };
  }
  // Every update enters durable storage before the companion's spool file is removed.
  accept(raw: unknown) {
    const input = inputSchema.parse(raw);
    const k = "chat:in:" + input.updateId;
    if (!this.s.get(k))
      this.s.put(k, {
        input,
        state: "pending",
        at: Date.now(),
      } satisfies Inbox);
  }
  ingestFiles() {
    mkdirSync(this.d.spool, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(this.d.spool)
      .filter((n) => /^\d+\.json$/.test(n))
      .sort((a, b) => Number(a.split(".")[0]) - Number(b.split(".")[0]))
      .slice(0, 100)) {
      const path = join(this.d.spool, name);
      try {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 40000)
          continue;
        this.accept(JSON.parse(readFileSync(path, "utf8")));
        unlinkSync(path);
      } catch {
        /* malformed files are retained for local inspection, without logging their text */
      }
    }
  }
  recover() {
    for (const { key, value: r } of this.s.list<Inbox>("chat:in:"))
      if (r.state === "claimed") {
        this.enqueue(
          r.input.topicId,
          this.tr(
            "⚠️ BB был перезапущен во время обработки сообщения. Исход действия не подтверждён. Открой /chats и проверь чат перед повторной отправкой.",
          ),
          undefined,
          "recovery:" + r.input.updateId,
        );
        this.s.put(key, {
          ...r,
          input: { ...r.input, text: undefined, voice: undefined },
          state: "done",
        });
      }
  }
  async tick() {
    if (this.disposed || this.d.signal.aborted) return;
    this.ingestFiles();
    for (const { key, value: r } of this.s
      .list<Inbox>("chat:in:")
      .sort((a, b) => a.value.input.updateId - b.value.input.updateId)) {
      if (
        r.state !== "pending" ||
        this.lanes.has(r.input.topicId) ||
        this.lanes.size >= 4
      )
        continue;
      this.lanes.add(r.input.topicId);
      this.s.put(key, { ...r, state: "claimed" });
      const p = this.handle(r.input)
        .catch((e) => {
          this.lastError = e instanceof Error ? e.name : "operation_failed";
          this.enqueue(
            r.input.topicId,
            this.tr(
              "⚠️ Не удалось подтвердить действие. Проверь /status и /chats перед повтором; подробности доступны в BB.",
            ),
            undefined,
            "error:" + r.input.updateId,
          );
        })
        .finally(() => {
          this.s.put(key, {
            input: { ...r.input, text: undefined, voice: undefined },
            state: "done",
            at: Date.now(),
          });
          this.lanes.delete(r.input.topicId);
          this.work.delete(p);
          this.d.wake?.();
        });
      this.work.add(p);
    }
    if (!this.observed && Date.now() >= this.nextObserve) {
      this.nextObserve = Date.now() + 2000;
      this.observed = true;
      const p = this.observe()
        .catch(() => {})
        .finally(() => {
          this.observed = false;
          this.work.delete(p);
        });
      this.work.add(p);
    }
    if (!this.flushing) {
      this.flushing = true;
      const p = this.flush().finally(() => {
        this.flushing = false;
        this.work.delete(p);
        if (
          this.s
            .list<Outbox>("chat:out:")
            .some(({ value: o }) => !o.sentId && o.retryAt <= Date.now())
        )
          this.d.wake?.();
      });
      this.work.add(p);
    }
    for (const { key, value } of this.s.list<{ at?: number; expires?: number }>(
      "chat:",
    ))
      if (
        ((key.startsWith("chat:in:") && (value as Inbox).state === "done") ||
          (key.startsWith("chat:out:") && (value as Outbox).sentId)) &&
        value.at &&
        value.at < Date.now() - 7 * 86400_000
      )
        this.s.del(key);
      else if (
        key.startsWith("chat:button:") &&
        value.expires &&
        value.expires < Date.now()
      )
        this.s.del(key);
  }
  async dispose() {
    this.disposed = true;
    await Promise.allSettled([...this.work]);
  }
  async projects(topicId: number) {
    const projects = (
      await this.d.sdk.projects.list({ signal: this.d.signal })
    ).filter((p) => p.kind === "standard");
    const b = this.binding(topicId) ?? {
      topicId,
      projectId: "",
      threadId: null,
      revision: "lobby",
      ready: false,
      cursor: 0,
    };
    this.enqueue(
      topicId,
      this.tr(
        "📂 Выбери проект. Новая тема будет привязана к нему.\n\nВнутри проекта: «Новый чат» или «Чаты» → подключиться → написать сообщение.\n/tasks — задачи; /menu — управление чатом.",
      ),
      projects
        .slice(0, 50)
        .map((p) => [this.button(b, "project", label(p.name), p.id)]),
    );
  }
  async menu(b: Binding) {
    const project = await this.d.sdk.projects.get({ projectId: b.projectId });
    let text = `📂 ${project.name}\n`;
    if (b.threadId) {
      const t = await this.validThread(b, b.threadId);
      const options = await this.d.sdk.threads.defaultExecutionOptions({
        threadId: t.id,
      });
      text +=
        "💬 " +
        String(t.title ?? t.titleFallback ?? t.id) +
        "\n" +
        String(this.tr(states[t.status] ?? t.status) ?? t.status) +
        "\n🤖 " +
        String(t.providerId) +
        "" +
        String(options ? " · " + options.model : "") +
        "\n📁 " +
        String(
          (t.environmentId
            ? (
                await this.d.sdk.environments.get({
                  environmentId: t.environmentId,
                })
              ).path
            : null) ?? this.tr("окружение BB"),
        ) +
        this.tr(
          "\n\nСообщение здесь продолжит этот чат. Другие чаты проекта не пересылаются.",
        );
    } else if (b.ready) {
      const providers = await this.d.sdk.providers.list(await this.routing(b));
      const provider =
        providers.find((p) => p.id === b.providerId)?.displayName ??
        b.providerId ??
        this.tr("По умолчанию BB");
      const hostId = await this.selectedHost(b);
      let hostName = hostId ?? this.tr("По умолчанию BB");
      if (hostId) {
        try {
          hostName = (await this.d.sdk.hosts.get({ hostId })).name;
        } catch {}
      }
      let model = b.model ?? this.tr("По умолчанию BB");
      if (b.providerId && b.model) {
        try {
          const c = await this.d.sdk.providers.models({
            providerId: b.providerId!,
            ...(await this.routing(b)),
          });
          model =
            c.models.find((m) => m.model === b.model)?.displayName ?? model;
        } catch {}
      }
      let folder = this.tr("Корень проекта");
      if (b.folderId) {
        const f = await this.folders();
        folder =
          f.folders.find((f) => f.id === b.folderId)?.name ??
          this.tr("выбран в меню");
      }
      text +=
        "\n" +
        this.tr("✚ Новый чат") +
        "\n\n" +
        this.tr("🖥 Сервер: ") +
        hostName +
        "\n" +
        this.tr("🤖 Провайдер: ") +
        provider +
        "\n" +
        this.tr("🧠 Модель: ") +
        model +
        "\n" +
        this.tr("🎭 Профиль: ") +
        (b.profileId ?? this.tr("По умолчанию BB")) +
        "\n" +
        this.tr("📁 Раздел: ") +
        folder +
        "\n\n" +
        this.tr("Напиши первое сообщение, чтобы начать.");
    } else text += this.tr("Чат отключён. Выбери «Новый чат» или «Чаты».");
    const keys = this.nav(b);
    if (b.threadId) keys.unshift([this.link(b.threadId)]);
    this.enqueue(b.topicId, text, keys);
  }
  private async validThread(b: Binding, id: string) {
    const t = await this.d.sdk.threads.get({
      threadId: id,
      signal: this.d.signal,
    });
    if (
      t.projectId !== b.projectId ||
      t.deletedAt ||
      t.archivedAt ||
      t.visibility === "hidden"
    )
      throw Error("thread_not_available");
    this.s.put("chat:thread-project:" + id, b.projectId);
    return t;
  }
  private async sessions(b: Binding, offset = 0) {
    const list = await this.d.sdk.threads.list({
      projectId: b.projectId,
      includeHidden: false,
      limit: 9,
      offset,
      signal: this.d.signal,
    });
    const keys = list
      .slice(0, 8)
      .map((t) => [
        this.button(
          b,
          "inspect",
          label(
            (t.id === b.threadId ? "✓ " : "") +
              (t.title ?? t.titleFallback ?? t.id),
          ),
          t.id,
        ),
      ]);
    const pages: Key[] = [];
    if (offset > 0)
      pages.push(
        this.button(
          b,
          "sessions",
          this.tr("← Назад"),
          String(Math.max(0, offset - 8)),
        ),
      );
    if (list.length > 8)
      pages.push(
        this.button(b, "sessions", this.tr("Далее →"), String(offset + 8)),
      );
    if (pages.length) keys.push(pages);
    keys.push([
      this.button(b, "new", this.tr("✚ Новый чат")),
      this.button(b, "menu", this.tr("В меню")),
    ]);
    this.enqueue(
      b.topicId,
      this.tr(
        "💬 Чаты проекта\nВыбери чат, чтобы посмотреть его состояние и подключиться.\nСтраница ",
      ) +
        (offset / 8 + 1),
      keys,
    );
  }
  private async folders() {
    return this.d.sdk.plugins.callRpc({
      pluginId: "project-folders",
      method: "list",
      input: null,
      outputSchema: foldersSchema,
    });
  }
  private async chooseFolder(b: Binding) {
    if (b.threadId) {
      this.enqueue(
        b.topicId,
        this.tr(
          "Раздел существующего чата сохраняется. Нажми «Новый чат», затем выбери раздел.",
        ),
        this.nav(b),
      );
      return;
    }
    const f = await this.folders();
    this.enqueue(
      b.topicId,
      this.tr(
        "📁 Где создать новый чат?\nИнструкции и файлы будут взяты из выбранного каталога.",
      ),
      [
        [this.button(b, "folder", this.tr("Корень проекта"), "")],
        ...f.folders
          .filter(
            (f) =>
              f.projectId === b.projectId &&
              (!b.hostId || f.hostId === b.hostId),
          )
          .slice(0, 40)
          .map((f) => [this.button(b, "folder", label(f.name, 60), f.id)]),
        [this.button(b, "menu", this.tr("В меню"))],
      ],
    );
  }
  private async selectedHost(b: Binding): Promise<string | undefined> {
    if (b.hostId) return b.hostId;
    if (b.folderId) {
      const f = (await this.folders()).folders.find(
        (f) => f.id === b.folderId && f.projectId === b.projectId,
      );
      if (f) return f.hostId;
    }
    const p = await this.d.sdk.projects.get({ projectId: b.projectId });
    return (p.sources?.find((s) => s.isDefault) ?? p.sources?.[0])?.hostId;
  }
  private async routing(
    b: Binding,
  ): Promise<{ hostId: string } | { hostId?: never }> {
    const hostId = await this.selectedHost(b);
    return hostId ? { hostId } : {};
  }
  private async chooseHost(b: Binding) {
    if (b.threadId) {
      this.enqueue(
        b.topicId,
        this.tr(
          "Сервер существующего чата сохраняется. Для другой машины создай новый чат.",
        ),
        this.nav(b),
      );
      return;
    }
    const hosts = await this.d.sdk.hosts.list();
    const project = await this.d.sdk.projects.get({ projectId: b.projectId });
    const choices = hosts
      .filter((h) => h.status === "connected")
      .map((h) =>
        this.button(
          b,
          "host",
          label(
            h.name +
              (project.sources.some((s) => s.hostId === h.id)
                ? ""
                : " · " + this.tr("нет папки проекта")),
            50,
          ),
          h.id,
        ),
      );
    const rows: Key[][] = [];
    for (let i = 0; i < choices.length; i += 2)
      rows.push(choices.slice(i, i + 2));
    rows.push([this.button(b, "menu", this.tr("В меню"))]);
    this.enqueue(
      b.topicId,
      this.tr(
        "🖥 Где запустить новый чат? Модели и профили будут взяты с выбранной машины.",
      ),
      rows,
    );
  }
  private async environment(b: Binding): Promise<CreateThreadEnvironmentArgs> {
    if (!b.folderId) {
      if (!b.hostId) return { type: "project-default" };
      const host = await this.d.sdk.hosts.get({ hostId: b.hostId });
      if (host.status !== "connected") throw Error("host_offline");
      const p = await this.d.sdk.projects.get({ projectId: b.projectId });
      const source = p.sources.find((s) => s.hostId === b.hostId);
      if (!source) throw Error("project_source_missing");
      return {
        type: "host",
        hostId: b.hostId,
        workspace: { type: "unmanaged", path: source.path },
      };
    }
    const fs = await this.folders();
    const f = fs.folders.find(
      (x) => x.id === b.folderId && x.projectId === b.projectId,
    );
    if (!f || (b.hostId && b.hostId !== f.hostId))
      throw Error("section_missing");
    return {
      type: "host",
      hostId: f.hostId,
      workspace: { type: "unmanaged", path: f.path },
    };
  }
  private async providers(b: Binding) {
    if (b.threadId) {
      this.enqueue(
        b.topicId,
        this.tr(
          "Модель текущего чата можно выбрать ниже. Другой агент выбирается для нового чата.",
        ),
        [
          [this.button(b, "models", this.tr("Модель текущего чата"))],
          [this.button(b, "newAgent", this.tr("Другой агент → новый чат"))],
          [this.button(b, "menu", this.tr("В меню"))],
        ],
      );
      return;
    }
    const providers = await this.d.sdk.providers.list(await this.routing(b));
    const choices = [
      this.button(b, "provider", this.tr("По умолчанию BB"), ""),
      ...providers
        .filter((p) => p.available)
        .map((p) => this.button(b, "provider", label(p.displayName), p.id)),
    ];
    const rows: Key[][] = [];
    for (let i = 0; i < choices.length; i += 2)
      rows.push(choices.slice(i, i + 2));
    this.enqueue(
      b.topicId,
      this.tr("🤖 Агент для нового чата. Его модели берутся из настроек BB."),
      [...rows, [this.button(b, "menu", this.tr("В меню"))]],
    );
  }
  private async profileTarget(b: Binding) {
    if (b.folderId) {
      const folders = await this.folders();
      const f = folders.folders.find(
        (f) => f.id === b.folderId && f.projectId === b.projectId,
      );
      if (!f) throw Error("section_missing");
      const envs = await this.d.sdk.environments.list({
        projectId: b.projectId,
        hostId: f.hostId,
        path: f.path,
      });
      const env = envs.find(
        (e) =>
          e.path === f.path &&
          e.projectId === b.projectId &&
          e.hostId === f.hostId,
      );
      if (!env) throw Error("profile_environment_missing");
      return { hostId: f.hostId, environmentId: env.id, cwd: f.path };
    }
    const project = await this.d.sdk.projects.get({ projectId: b.projectId });
    const source = b.hostId
      ? project.sources.find((s) => s.hostId === b.hostId)
      : (project.sources.find((s) => s.isDefault) ?? project.sources[0]);
    if (!source) throw Error("profile_host_missing");
    return { hostId: source.hostId, environmentId: null, cwd: source.path };
  }
  private async profiles(b: Binding, offset = 0) {
    if (
      b.threadId ||
      !["codex", "claude-code", "acp-opencode"].includes(b.providerId ?? "")
    )
      return this.menu(b);
    const installed = await this.d.sdk.plugins.list();
    if (
      !installed.plugins.some(
        (p) => p.id === "cli-agents" && p.status === "running",
      )
    ) {
      b.profileId = undefined;
      b.profileTarget = undefined;
      this.save(b);
      return this.menu(b);
    }
    try {
      const target = await this.profileTarget(b);
      const catalog = await this.d.sdk.plugins.callRpc({
        pluginId: "cli-agents",
        method: "catalog",
        input: { ...target, projectId: b.projectId, providerId: b.providerId! },
        outputSchema: z.object({
          supported: z.boolean(),
          agents: z.array(
            z.object({ id: z.string(), description: z.string() }),
          ),
          warnings: z.array(z.string()),
        }),
      });
      if (!catalog.supported || !catalog.agents.length) {
        b.profileId = undefined;
        b.profileTarget = undefined;
        this.save(b);
        this.enqueue(
          b.topicId,
          this.tr(
            "На выбранном сервере для этого провайдера профили не найдены. Будет использован агент по умолчанию.",
          ),
          [
            [
              this.button(b, "hosts", this.tr("🖥 Сервер")),
              this.button(b, "menu", this.tr("В меню")),
            ],
          ],
        );
        return;
      }
      const pageSize = 8;
      const totalPages = Math.ceil(catalog.agents.length / pageSize);
      offset =
        Math.max(
          0,
          Math.min(
            totalPages - 1,
            Math.floor((Number.isFinite(offset) ? offset : 0) / pageSize),
          ),
        ) * pageSize;
      const choices = catalog.agents
        .slice(offset, offset + pageSize)
        .map((a) => this.button(b, "profile", label(a.id, 45), a.id));
      const keys: Key[][] = [];
      for (let i = 0; i < choices.length; i += 2)
        keys.push(choices.slice(i, i + 2));
      keys.push([this.button(b, "profile", this.tr("По умолчанию BB"), "")]);
      const pages: Key[] = [];
      if (offset > 0)
        pages.push(
          this.button(b, "profiles", this.tr("← Назад"), String(offset - 8)),
        );
      if (catalog.agents.length > offset + 8)
        pages.push(
          this.button(b, "profiles", this.tr("Далее →"), String(offset + 8)),
        );
      if (pages.length) keys.push(pages);
      keys.push([this.button(b, "menu", this.tr("В меню"))]);
      this.enqueue(
        b.topicId,
        this.tr(
          "🎭 Выбери профиль агента для нового чата. Модель уже выбрана.",
        ) +
          "\n\n" +
          this.tr("Страница ") +
          (offset / pageSize + 1) +
          " / " +
          totalPages,
        keys,
      );
    } catch {
      this.enqueue(
        b.topicId,
        this.tr(
          "Не удалось загрузить профили CLI Agents для выбранного раздела. Повтори выбор или используй настройки по умолчанию.",
        ),
        [
          [this.button(b, "profiles", this.tr("Повторить"))],
          [this.button(b, "profile", this.tr("По умолчанию BB"), "")],
        ],
      );
    }
  }
  private async models(b: Binding, offset = 0) {
    const t = b.threadId ? await this.validThread(b, b.threadId) : undefined;
    const providerId = t?.providerId ?? b.providerId;
    if (!providerId) {
      await this.providers(b);
      return;
    }
    const catalog = await this.d.sdk.providers.models(
      t?.environmentId
        ? { providerId, environmentId: t.environmentId }
        : { providerId, ...(await this.routing(b)) },
    );
    if (catalog.modelLoadError) throw Error("models_unavailable");
    const choices = catalog.models
      .slice(offset, offset + 8)
      .map((m) =>
        this.button(b, "model", label(m.displayName), m.model, providerId),
      );
    const keys: Key[][] = [];
    for (let i = 0; i < choices.length; i += 2)
      keys.push(choices.slice(i, i + 2));
    const pages: Key[] = [];
    if (offset > 0)
      pages.push(
        this.button(b, "models", this.tr("← Назад"), String(offset - 8)),
      );
    if (catalog.models.length > offset + 8)
      pages.push(
        this.button(b, "models", this.tr("Далее →"), String(offset + 8)),
      );
    if (pages.length) keys.push(pages);
    keys.push([this.button(b, "menu", this.tr("В меню"))]);
    this.enqueue(
      b.topicId,
      this.tr("Модель ") +
        providerId +
        "\n" +
        (t
          ? this.tr("Применится к текущему чату, когда он свободен.")
          : this.tr("Применится к новому чату.")),
      keys,
    );
  }
  async handle(input: ChatInput) {
    const a = input.callback?.startsWith("bb:")
      ? this.s.get<Action>("chat:button:" + input.callback.slice(3))
      : undefined;
    const menus = [
      "project",
      "projects",
      "menu",
      "sessions",
      "inspect",
      "connect",
      "new",
      "disconnect",
      "folders",
      "folder",
      "newAgent",
      "providers",
      "provider",
      "models",
      "model",
      "hosts",
      "host",
      "profiles",
      "profile",
      "stopConfirm",
    ];
    if (a && menus.includes(a.kind))
      return this.navigation.run(
        { topicId: input.topicId, messageId: input.messageId },
        () => this.handleInput(input),
      );
    return this.handleInput(input);
  }
  private async handleInput(input: ChatInput) {
    let b = this.binding(input.topicId);
    if (input.callback) {
      const id = input.callback.replace(/^bb:/, "");
      const a = this.s.get<Action>("chat:button:" + id);
      if (
        !a ||
        a.used ||
        a.expires < Date.now() ||
        a.topicId !== input.topicId ||
        a.revision !== (b?.revision ?? "lobby")
      ) {
        this.enqueue(input.topicId, this.tr("Кнопка устарела. Открой /menu."));
        return;
      }
      this.s.put("chat:button:" + id, { ...a, used: true });
      if (a.kind === "project") {
        await this.d.sdk.projects.get({ projectId: a.arg! });
        const fixed = this.s
          .list<Topic>("topic:")
          .find((x) => x.value.threadId === input.topicId)?.value;
        if (fixed && fixed.key !== a.arg) {
          const t = this.s.get<Topic>("topic:" + a.arg);
          if (!t?.threadId || t.missingSince)
            throw Error("project_topic_missing");
          await this.menu(this.binding(t.threadId)!);
          this.enqueue(
            input.topicId,
            this.tr("Меню отправлено в тему «") +
              t.name +
              this.tr(
                "». Для отдельного разговора создай тему Telegram и выбери в ней /project.",
              ),
          );
          return;
        }
        if (b && b.projectId === a.arg) {
          await this.menu(b);
          return;
        }
        const bound: Binding = {
          topicId: input.topicId,
          projectId: a.arg!,
          threadId: null,
          ready: true,
          revision: fresh(),
          cursor: 0,
        };
        this.save(bound);
        await this.menu(bound);
        return;
      }
      if (!b) {
        await this.projects(input.topicId);
        return;
      }
      await this.action(b, a);
      return;
    }
    let text = input.text?.trim() ?? "";
    const [raw, ...args] = text.split(/\s+/);
    const cmd = raw?.split("@")[0].toLowerCase();
    if (["/start", "/help", "/menu", "/status"].includes(cmd)) {
      if (b) await this.menu(b);
      else await this.projects(input.topicId);
      return;
    }
    if (cmd === "/projects" || cmd === "/project") {
      await this.projects(input.topicId);
      return;
    }
    if (!b) {
      this.enqueue(
        input.topicId,
        this.tr(
          "Сначала привяжи эту тему командой /project. В теме SMS сообщения не отправляются агенту.",
        ),
      );
      return;
    }
    const commands: Record<string, string> = {
      "/chats": "sessions",
      "/sessions": "sessions",
      "/new": "new",
      "/reset": "new",
      "/disconnect": "disconnect",
      "/stop": "stopConfirm",
      "/history": "history",
      "/section": "folders",
      "/agent": "providers",
      "/model": "providers",
      "/server": "hosts",
      "/servers": "hosts",
      "/profile": "profiles",
    };
    if (commands[cmd]) {
      await this.action(b, {
        kind: commands[cmd],
        topicId: b.topicId,
        revision: b.revision,
        expires: Date.now() + 1000,
      });
      return;
    }
    if (cmd === "/use" && args[0]) {
      await this.action(b, {
        kind: "inspect",
        arg: args[0],
        topicId: b.topicId,
        revision: b.revision,
        expires: Date.now() + 1000,
      });
      return;
    }
    if (cmd === "/say") text = args.join(" ");
    else if (text.startsWith("/")) {
      this.enqueue(
        input.topicId,
        this.tr(
          "Неизвестная команда. /menu — управление, /say /команда — отправить команду как текст агенту.",
        ),
      );
      return;
    }
    if (input.voice) {
      if (!this.d.transcribe) {
        this.enqueue(
          input.topicId,
          this.tr("Транскрибация сейчас недоступна. Отправь текст."),
        );
        return;
      }
      try {
        text = await this.d.transcribe(input.voice);
      } catch {
        this.enqueue(
          input.topicId,
          this.tr(
            "Не удалось распознать голос. Отправь текст или проверь транскрибацию в настройках BB. Ограничение: 10 минут и 15 МБ.",
          ),
        );
        return;
      }
      this.enqueue(
        input.topicId,
        this.tr("🎙 Распознано:\n") + text.slice(0, 3000),
      );
    }
    if (!text) {
      this.enqueue(
        input.topicId,
        this.tr(
          "Отправь текст или голосовое сообщение. Вложения пока открывай в BB.",
        ),
      );
      return;
    }
    if (b.threadId && input.replyTo) {
      const q = this.s.get<{
        threadId: string;
        interactionId: string;
        revision: string;
      }>("chat:question:" + input.topicId + ":" + input.replyTo);
      if (q) {
        await this.answerText(b, q, text);
        return;
      }
    }
    if (b.threadId) {
      const pending = await this.d.sdk.threads.interactions.list({
        threadId: b.threadId,
        signal: this.d.signal,
      });
      if (pending.some((i) => i.status === "pending")) {
        this.enqueue(
          input.topicId,
          this.tr(
            "В чате есть вопрос. Ответь через кнопку или ответом на его карточку. Если форма сложная — открой BB.",
          ),
          [[this.link(b.threadId)]],
        );
        return;
      }
      await this.validThread(b, b.threadId);
      await this.d.sdk.threads.send({
        threadId: b.threadId,
        mode: "auto",
        input: [{ type: "text", text, mentions: [] }],
      });
    } else {
      if (!b.ready) {
        await this.menu(b);
        return;
      }
      const environment = await this.environment(b);
      let prompt = text;
      if (b.profileId) {
        const target = await this.profileTarget(b);
        if (JSON.stringify(target) !== JSON.stringify(b.profileTarget))
          throw Error("profile_target_changed");
        const selection = await this.d.sdk.plugins.callRpc({
          pluginId: "cli-agents",
          method: "select",
          input: {
            ...target,
            projectId: b.projectId,
            providerId: b.providerId!,
            agentId: b.profileId,
          },
          outputSchema: z.object({
            token: z.string().uuid(),
            label: z.string(),
          }),
        });
        prompt = "[cli-agents-selection:" + selection.token + "]\n" + text;
      }
      const t = await this.d.sdk.threads.spawn({
        projectId: b.projectId,
        environment,
        prompt,
        title: label(text, 85),
        visibility: "visible",
        ...(b.providerId ? { providerId: b.providerId } : {}),
        ...(b.model ? { model: b.model } : {}),
      });
      b = { ...b, threadId: t.id, cursor: 0, ready: false };
      this.save(b);
    }
    this.enqueue(
      input.topicId,
      this.tr(
        "📨 Сообщение принято BB. Ответ придёт сюда.\n/stop — остановить, /menu — текущий чат.",
      ),
      [[this.link(b.threadId!)]],
      "accepted:" + input.updateId,
    );
  }
  private async action(b: Binding, a: Action) {
    switch (a.kind) {
      case "hosts":
        return this.chooseHost(b);
      case "host": {
        if (b.threadId) throw Error("new_thread_required");
        const host = await this.d.sdk.hosts.get({ hostId: a.arg! });
        if (host.status !== "connected") throw Error("host_offline");
        const project = await this.d.sdk.projects.get({
          projectId: b.projectId,
        });
        if (!project.sources.some((s) => s.hostId === a.arg)) {
          this.enqueue(
            b.topicId,
            this.tr(
              "Для этой машины ещё не настроена папка проекта в BB. Добавь источник проекта и повтори выбор сервера.",
            ),
            [[this.button(b, "hosts", this.tr("🖥 Сервер"))]],
          );
          return;
        }
        b = {
          ...b,
          hostId: a.arg,
          folderId: undefined,
          providerId: undefined,
          model: undefined,
          profileId: undefined,
          profileTarget: undefined,
          revision: fresh(),
        };
        this.save(b);
        return this.providers(b);
      }
      case "projects":
        return this.projects(b.topicId);
      case "menu":
        return this.menu(b);
      case "sessions":
        return this.sessions(b, Number(a.arg) || 0);
      case "inspect": {
        const t = await this.validThread(b, a.arg!);
        this.enqueue(
          b.topicId,
          "💬 " +
            String(t.title ?? t.titleFallback ?? t.id) +
            "\n" +
            String(this.tr(states[t.status] ?? t.status)) +
            "\n🤖 " +
            String(t.providerId) +
            "\n📁 " +
            String(
              (t.environmentId
                ? (
                    await this.d.sdk.environments.get({
                      environmentId: t.environmentId,
                    })
                  ).path
                : null) ?? "BB",
            ) +
            this.tr(
              "\n\nПодключение будет пересылать новые ответы и вопросы этого чата в текущую тему.",
            ),
          [
            [this.button(b, "connect", this.tr("Подключиться"), t.id)],
            [this.button(b, "peek", this.tr("Последний ответ"), t.id)],
            [this.link(t.id)],
            [this.button(b, "sessions", this.tr("← Чаты"))],
          ],
        );
        return;
      }
      case "connect": {
        const selected = await this.validThread(b, a.arg!);
        const defaults = await this.d.sdk.threads.defaultExecutionOptions({
          threadId: selected.id,
        });
        if (
          this.bindings().some(
            (x) => x.topicId !== b.topicId && x.threadId === a.arg,
          )
        ) {
          this.enqueue(
            b.topicId,
            this.tr(
              "Этот чат уже подключён к другой теме. Сначала отключи его там.",
            ),
          );
          return;
        }
        const latest = await this.d.sdk.threads.events.list({
          threadId: a.arg!,
          order: "desc",
          limit: "1",
          signal: this.d.signal,
        });
        b = {
          ...b,
          profileId: undefined,
          profileTarget: undefined,
          providerId: selected.providerId,
          model: defaults?.model,
          threadId: a.arg!,
          ready: false,
          revision: fresh(),
          cursor: latest[0]?.seq ?? 0,
          status: undefined,
          progressId: undefined,
        };
        this.save(b);
        return this.menu(b);
      }
      case "new":
      case "disconnect":
        b = {
          ...b,
          threadId: null,
          ready: a.kind === "new",
          revision: fresh(),
          cursor: 0,
          status: undefined,
          progressId: undefined,
        };
        this.save(b);
        return this.menu(b);
      case "folders":
        return this.chooseFolder(b);
      case "folder":
        if (b.threadId) throw Error("new_thread_required");
        if (a.arg) {
          const f = await this.folders();
          if (
            !f.folders.some(
              (x) => x.id === a.arg && x.projectId === b.projectId,
            )
          )
            throw Error("section_missing");
        }
        b.profileId = undefined;
        b.profileTarget = undefined;
        if (a.arg) {
          const f = (await this.folders()).folders.find(
            (f) => f.id === a.arg && f.projectId === b.projectId,
          );
          if (!f) throw Error("section_missing");
          if (b.hostId && b.hostId !== f.hostId) throw Error("host_changed");
          b.hostId = f.hostId;
        }
        b.folderId = a.arg || undefined;
        this.save(b);
        return this.menu(b);
      case "newAgent":
        b = {
          ...b,
          threadId: null,
          ready: true,
          revision: fresh(),
          cursor: 0,
          status: undefined,
        };
        this.save(b);
        return this.providers(b);
      case "providers":
        return this.providers(b);
      case "provider":
        if (b.threadId) throw Error("new_thread_required");
        if (
          a.arg &&
          !(await this.d.sdk.providers.list(await this.routing(b))).some(
            (p) => p.id === a.arg,
          )
        )
          throw Error("provider_missing");
        b.profileId = undefined;
        b.profileTarget = undefined;
        b.providerId = a.arg || undefined;
        b.model = undefined;
        this.save(b);
        return a.arg ? this.models(b) : this.menu(b);
      case "profiles":
        return this.profiles(b, Number(a.arg) || 0);
      case "profile": {
        if (b.threadId) throw Error("new_thread_required");
        if (a.arg) {
          const target = await this.profileTarget(b);
          await this.d.sdk.plugins.callRpc({
            pluginId: "cli-agents",
            method: "select",
            input: {
              ...target,
              projectId: b.projectId,
              providerId: b.providerId!,
              agentId: a.arg,
            },
            outputSchema: z.object({ token: z.string(), label: z.string() }),
          });
          b.profileId = a.arg;
          b.profileTarget = target;
        } else {
          b.profileId = undefined;
          b.profileTarget = undefined;
        }
        this.save(b);
        return this.menu(b);
      }
      case "models":
        return this.models(b, Number(a.arg) || 0);
      case "model": {
        const t = b.threadId
          ? await this.validThread(b, b.threadId)
          : undefined;
        if (t && t.status !== "idle" && t.status !== "error") {
          this.enqueue(
            b.topicId,
            this.tr(
              "Смена модели доступна после завершения или остановки текущего запуска.",
            ),
          );
          return;
        }
        const providerId = t?.providerId ?? b.providerId;
        if (providerId !== a.extra) throw Error("provider_changed");
        const c = await this.d.sdk.providers.models(
          t?.environmentId
            ? { providerId, environmentId: t.environmentId }
            : { providerId, ...(await this.routing(b)) },
        );
        if (!c.models.some((m) => m.model === a.arg))
          throw Error("model_missing");
        if (t)
          await this.d.sdk.threads.update({ threadId: t.id, model: a.arg! });
        b.model = a.arg;
        b.providerId = providerId;
        this.save(b);
        if (!t) return this.profiles(b);
        return this.menu(b);
      }
      case "history":
      case "peek": {
        const id = a.arg ?? b.threadId;
        if (!id) {
          await this.menu(b);
          return;
        }
        await this.validThread(b, id);
        const result = await this.d.sdk.threads.output({
          threadId: id,
          signal: this.d.signal,
        });
        this.enqueue(
          b.topicId,
          this.tr("📖 Последний ответ\n\n") +
            (result.output ?? this.tr("В этом чате ещё нет ответа.")),
          [[this.link(id)]],
          fresh(),
          this.d.rich(),
        );
        return;
      }
      case "stopConfirm":
        if (b.threadId)
          this.enqueue(
            b.topicId,
            this.tr("Остановить текущий запуск? Чат и история сохранятся."),
            [
              [this.button(b, "stop", this.tr("Да, остановить"), b.threadId)],
              [this.button(b, "menu", this.tr("Назад"))],
            ],
          );
        else await this.menu(b);
        return;
      case "stop":
        if (a.arg !== b.threadId) throw Error("binding_changed");
        await this.validThread(b, b.threadId!);
        await this.d.sdk.threads.stop({ threadId: b.threadId! });
        this.enqueue(
          b.topicId,
          this.tr("Команда остановки отправлена BB."),
          this.nav(b),
        );
        return;
      case "resolve":
        return this.resolve(b, a);
    }
  }
  private async resolve(b: Binding, a: Action) {
    if (!b.threadId) throw Error("not_bound");
    const interaction = await this.d.sdk.threads.interactions.get({
      threadId: b.threadId,
      interactionId: a.arg!,
    });
    if (interaction.status !== "pending") {
      this.enqueue(b.topicId, this.tr("Этот вопрос уже закрыт в BB."));
      return;
    }
    const payload = interaction.payload;
    if (
      payload.kind === "approval" &&
      (a.extra === "allow_once" || a.extra === "deny") &&
      payload.availableDecisions.includes(a.extra)
    )
      await this.d.sdk.threads.interactions.resolve({
        threadId: b.threadId,
        interactionId: interaction.id,
        resolution:
          a.extra === "deny"
            ? { decision: "deny" }
            : {
                decision: "allow_once",
                grantedPermissions:
                  payload.subject.kind === "permission_grant"
                    ? payload.subject.permissions
                    : null,
              },
      });
    else if (
      payload.kind === "user_question" &&
      payload.questions.length === 1
    ) {
      const q = payload.questions[0];
      const option = q.options?.find((o) => o.value === a.extra);
      if (!option || q.multiSelect) throw Error("unsupported_question");
      await this.d.sdk.threads.interactions.resolve({
        threadId: b.threadId,
        interactionId: interaction.id,
        resolution: {
          kind: "user_answer",
          answers: { [q.id]: { selected: [option.value] } },
        },
      });
    } else throw Error("unsupported_question");
    this.enqueue(b.topicId, this.tr("Ответ передан BB."));
  }
  private async answerText(
    b: Binding,
    q: { threadId: string; interactionId: string; revision: string },
    text: string,
  ) {
    if (q.threadId !== b.threadId || q.revision !== b.revision) {
      this.enqueue(
        b.topicId,
        this.tr("Вопрос относится к прежнему подключению. Открой /menu."),
      );
      return;
    }
    const i = await this.d.sdk.threads.interactions.get({
      threadId: q.threadId,
      interactionId: q.interactionId,
    });
    if (i.status !== "pending") {
      this.enqueue(b.topicId, this.tr("Этот вопрос уже закрыт."));
      return;
    }
    if (
      i.payload.kind !== "user_question" ||
      i.payload.questions.length !== 1 ||
      !i.payload.questions[0].allowFreeText
    ) {
      this.enqueue(
        b.topicId,
        this.tr("Для этого вопроса выбери кнопку или открой BB."),
      );
      return;
    }
    const question = i.payload.questions[0];
    await this.d.sdk.threads.interactions.resolve({
      threadId: q.threadId,
      interactionId: q.interactionId,
      resolution: {
        kind: "user_answer",
        answers: { [question.id]: { selected: [], freeText: text } },
      },
    });
    this.enqueue(b.topicId, this.tr("Ответ передан BB."));
  }
  private question(b: Binding, i: PendingInteraction) {
    const id = "question:" + b.revision + ":" + i.id;
    if (this.s.get("chat:out:" + id)) return;
    let text = this.tr("❓ BB ждёт ответа\n");
    const keys: Key[][] = [];
    if (i.payload.kind === "approval") {
      const p = i.payload;
      text +=
        this.tr("Требуется разрешение\n") +
        (p.reason ?? "") +
        "\n" +
        JSON.stringify(p.subject, null, 2).slice(0, 2400);
      for (const decision of ["allow_once", "deny"] as const)
        if (p.availableDecisions.includes(decision))
          keys.push([
            this.button(
              b,
              "resolve",
              decision === "allow_once"
                ? this.tr("Разрешить один раз")
                : this.tr("Отказать"),
              i.id,
              decision,
            ),
          ]);
    } else if (i.payload.kind === "user_question") {
      text += i.payload.questions
        .map((q) => q.prompt)
        .join("\n\n")
        .slice(0, 2400);
      if (i.payload.questions.length === 1) {
        const q = i.payload.questions[0];
        if (!q.multiSelect)
          for (const o of q.options ?? [])
            keys.push([
              this.button(b, "resolve", label(o.label), i.id, o.value),
            ]);
        if (q.allowFreeText)
          text += this.tr(
            "\n\nМожно ответить текстом через «Ответить» на это сообщение.",
          );
      } else text += this.tr("\n\nНесколько вопросов: открой форму в BB.");
    } else text += this.tr("Эта форма открывается в BB.");
    keys.push([this.link(b.threadId!)]);
    this.enqueue(b.topicId, text, keys, id);
    this.s.put("chat:question-out:" + id, {
      threadId: b.threadId,
      interactionId: i.id,
      revision: b.revision,
    });
  }
  async observe() {
    for (const b of this.bindings()) {
      if (!b.threadId || this.lanes.has(b.topicId)) continue;
      try {
        const t = await this.validThread(b, b.threadId);
        const events = await this.d.sdk.threads.events.list({
          threadId: b.threadId,
          afterSeq: String(b.cursor),
          types: [
            "item/started",
            "item/completed",
            "turn/completed",
            "turn/started",
          ],
          limit: "100",
          signal: this.d.signal,
        });
        const current = this.binding(b.topicId);
        if (current?.revision !== b.revision || current.threadId !== b.threadId)
          continue;
        for (const event of events) {
          if (event.type === "item/started") {
            const item = event.data.item;
            if (
              [
                "commandExecution",
                "mcpToolCall",
                "toolCall",
                "fileChange",
                "webSearch",
              ].includes(item.type)
            ) {
              const presentation =
                "presentation" in item ? item.presentation : undefined;
              b.activity = label(
                presentation?.title ?? presentation?.label.pending ?? item.type,
                100,
              );
            }
          }
          if (event.type === "turn/completed") {
            b.activity = undefined;
            if (
              event.data.status !== "completed" &&
              event.scope.kind === "turn"
            )
              this.s.del(
                "chat:candidate:" + b.revision + ":" + event.scope.turnId,
              );
          }
          if (
            event.type === "item/completed" &&
            event.data.item.type === "agentMessage" &&
            !event.data.item.parentToolCallId &&
            event.scope.kind === "turn"
          ) {
            this.s.put(
              "chat:candidate:" + b.revision + ":" + event.scope.turnId,
              event.data.item.text,
            );
          }
          if (
            event.type === "turn/completed" &&
            event.data.status === "completed" &&
            event.scope.kind === "turn"
          ) {
            const k = "chat:candidate:" + b.revision + ":" + event.scope.turnId;
            const text = this.s.get<string>(k);
            if (text?.trim())
              this.enqueue(
                b.topicId,
                text,
                [[this.link(b.threadId)]],
                "event:" + b.revision + ":" + event.seq,
                this.d.rich(),
              );
            this.s.del(k);
          }
          if (
            event.type === "turn/completed" &&
            event.data.status !== "completed"
          )
            this.enqueue(
              b.topicId,
              event.data.status === "failed"
                ? this.tr("⚠️ Запуск завершился ошибкой. Подробности в BB.")
                : this.tr("⏹ Запуск остановлен."),
              [[this.link(b.threadId)]],
              "end:" + b.revision + ":" + event.seq,
            );
          b.cursor = event.seq;
        }
        const pending = await this.d.sdk.threads.interactions.list({
          threadId: b.threadId,
          signal: this.d.signal,
        });
        for (const i of pending.filter((i) => i.status === "pending"))
          this.question(b, i);
        const status = pending.some((i) => i.status === "pending")
          ? this.tr("нужен ответ")
          : (this.tr(states[t.status] ?? t.status) ?? t.status) +
            (t.status === "active" && b.activity ? " · " + b.activity : "");
        if (
          status !== b.status &&
          (t.status !== "active" || Date.now() - (b.lastProgress ?? 0) > 5000)
        ) {
          b.lastProgress = Date.now();
          this.enqueue(
            b.topicId,
            "📍 " +
              label(t.title ?? t.titleFallback ?? this.tr("Чат BB"), 75) +
              "\n" +
              status,
            [
              [
                this.button(b, "menu", this.tr("Управление")),
                this.link(b.threadId),
              ],
            ],
            "progress:" + b.revision + ":" + fresh(),
            false,
            this.s.get<number>("chat:progress:" + b.topicId + ":" + b.revision),
          );
          b.status = status;
        }
        // Binding writes may never overwrite a user's concurrent menu action.
        if (
          !this.lanes.has(b.topicId) &&
          this.binding(b.topicId)?.revision === b.revision
        )
          this.save(b);
      } catch {
        this.lastError = "bound_thread_unavailable";
      }
    }
  }
  async flush() {
    let count = 0;
    for (const { key, value: o } of this.s
      .list<Outbox>("chat:out:")
      .sort((a, b) => a.value.at - b.value.at)) {
      if (this.disposed || this.d.signal.aborted || count >= 8) break;
      if (o.sentId || o.retryAt > Date.now()) continue;
      if (o.revision && this.binding(o.topicId)?.revision !== o.revision) {
        this.s.put(key, { ...o, sentId: -1, text: "", keys: undefined });
        continue;
      }
      count++;
      try {
        const chunks = splitText(o.text); // Durable per-part receipts prevent already-confirmed parts from replaying.
        let last = 0;
        for (let index = 0; index < chunks.length; index++) {
          const partKey = "chat:receipt:" + key + ":" + index;
          const old = this.s.get<number>(partKey);
          if (old) {
            last = old;
            continue;
          }
          const payload = {
            message_thread_id: o.topicId || undefined,
            disable_notification: !key.startsWith("chat:out:question:"),
            link_preview_options: { is_disabled: true },
            ...(index === chunks.length - 1 && o.keys
              ? { reply_markup: { inline_keyboard: o.keys } }
              : {}),
          };
          const editId =
            o.editId ??
            (key.startsWith("chat:out:progress:") && o.revision
              ? this.s.get<number>(
                  "chat:progress:" + o.topicId + ":" + o.revision,
                )
              : undefined);
          let result: any;
          let edited = Boolean(editId);
          try {
            result = await this.d.tg(
              editId
                ? "editMessageText"
                : o.rich
                  ? "sendRichMessage"
                  : "sendMessage",
              {
                ...payload,
                ...(editId ? { message_id: editId } : {}),
                ...(o.rich
                  ? { rich_message: { markdown: chunks[index] } }
                  : { text: chunks[index] }),
              },
            );
          } catch (e) {
            if (
              (o.rich || editId) &&
              e instanceof TelegramFailure &&
              e.code === "telegram_400"
            ) {
              edited = false;
              result = await this.d.tg("sendMessage", {
                ...payload,
                text: chunks[index],
              });
            } else throw e;
          }
          last = edited ? editId! : result.message_id;
          this.s.put(partKey, last);
        }
        this.s.put(key, { ...o, sentId: last, text: "", keys: undefined });
        if (key.startsWith("chat:out:progress:") && o.revision)
          this.s.put("chat:progress:" + o.topicId + ":" + o.revision, last);
        const question = this.s.get(
          "chat:question-out:" + key.slice("chat:out:".length),
        );
        if (question)
          this.s.put("chat:question:" + o.topicId + ":" + last, question);
      } catch (e) {
        this.s.put(key, {
          ...o,
          error: e instanceof TelegramFailure ? e.code : "delivery_failed",
          retryAt:
            Date.now() +
            (e instanceof TelegramFailure ? e.retryAfter : 30) * 1000,
        });
        break;
      }
    }
  }
  status() {
    return {
      lastError: this.lastError,
      deliveryErrors: this.s
        .list<Outbox>("chat:out:")
        .filter((x) => !x.value.sentId && x.value.error)
        .map((x) => ({ topicId: x.value.topicId, error: x.value.error })),
      bindings: this.bindings().map((b) => ({
        topicId: b.topicId,
        projectId: b.projectId,
        threadId: b.threadId,
        ready: b.ready,
      })),
      pending: this.s
        .list<Inbox>("chat:in:")
        .filter((x) => x.value.state !== "done").length,
      outgoing: this.s
        .list<Outbox>("chat:out:")
        .filter((x) => !x.key.includes(":part:") && !x.value.sentId).length,
    };
  }
}
