import { useEffect, useState, type ReactNode } from "react";
import "./app.css";
import {
  definePluginApp,
  experimental_ProviderModelPicker as ProviderModelPicker,
  useRpc,
  type ExperimentalProviderModelPickerValue as PickerValue,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import type { z } from "zod";
import type { preferencesSchema, Diagnosis } from "./settings";
import type { EventKind, Events } from "./events";
import { BOT_COMMANDS, type BotCommand } from "./commands";
type Preferences = z.infer<typeof preferencesSchema>;
type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type T = (ru: string, en: string) => string;
type EventsData = {
  events: Events;
  projects: {
    id: string;
    name: string;
    hidden: boolean;
    topicId: number | null;
  }[];
};
const TABS = ["overview", "events", "topics", "connection", "general"] as const;
type Tab = (typeof TABS)[number];

// Frequent work first: status and events; connection and general settings are rarely touched.
function Panel() {
  const rpc = useRpc<typeof rpcContract>();
  const [form, setForm] = useState<Preferences | null>(null),
    [source, setSource] = useState<"manual" | "env" | "none">("none"),
    [tokenEnv, setTokenEnv] = useState(""),
    [data, setData] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [tab, setTab] = useState<Tab>(() => {
      const saved = localStorage.getItem("telegram-projects:tab");
      return TABS.includes(saved as Tab) ? (saved as Tab) : "overview";
    });
  const en = form?.language === "en";
  const t: T = (ru, english) => (en ? english : ru);
  async function load() {
    try {
      const [p, s] = await Promise.all([
        rpc.call("preferences", null),
        rpc.call("status", null),
      ]);
      const { tokenPresent: _, tokenSource, tokenEnv: env, ...prefs } = p;
      setForm(prefs);
      setSource(tokenSource);
      setTokenEnv(env);
      setData(s);
    } catch {
      setNotice("Не удалось загрузить настройки / Could not load settings");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch {
      setNotice(
        t(
          "Не удалось выполнить действие. Проверь подключение к BB.",
          "Action failed. Check your connection to BB.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  async function savePreferences(next: Preferences) {
    try {
      if (new URL(next.appUrl).protocol !== "https:") throw 0;
    } catch {
      setNotice(
        t(
          "Укажи полный адрес BB с https://",
          "Enter the full BB URL starting with https://",
        ),
      );
      return;
    }
    await rpc.call("savePreferences", next);
    setForm(next);
    setNotice(t("Настройки сохранены.", "Settings saved."));
  }
  const choose = (next: Tab) => {
    setTab(next);
    localStorage.setItem("telegram-projects:tab", next);
  };
  const labels: Record<Tab, string> = {
    overview: t("Обзор", "Overview"),
    events: t("События", "Events"),
    topics: t("Темы", "Topics"),
    connection: t("Подключение", "Connection"),
    general: t("Общие", "General"),
  };
  return (
    <div
      className="h-full min-h-0 w-full overflow-y-auto"
      style={{ height: "100%", minHeight: 0, overflowY: "auto" }}
    >
      <main className="max-w-4xl mx-auto p-6 pb-12 space-y-4">
        <header className="tg-strip flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Telegram · BB</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t(
                "Темы проектов, отчёты агентов, задачи и чат с BB.",
                "Project topics, agent reports, tasks and chat with BB.",
              )}
            </p>
          </div>
          {data && (
            <span
              className={
                "tg-pill " +
                (data.enabled && !data.ingressError && source !== "none"
                  ? "tg-pill-success"
                  : "tg-pill-danger")
              }
            >
              @{data.bot} ·{" "}
              {!data.enabled
                ? t("выключен", "off")
                : source === "none"
                  ? t("нет токена", "no token")
                  : data.ingressError
                    ? t("нет приёма", "not receiving")
                    : t("на связи", "online")}
            </span>
          )}
        </header>
        <nav className="tg-seg" role="tablist">
          {TABS.map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              className="tg-seg-item"
              onClick={() => choose(k)}
            >
              {labels[k]}
            </button>
          ))}
        </nav>
        {notice && (
          <p role="status" className="tg-pill tg-pill-info">
            {notice}
          </p>
        )}
        {!form ? (
          <button className="tg-btn" onClick={() => void load()}>
            Повторить / Retry
          </button>
        ) : tab === "overview" ? (
          <Overview
            t={t}
            data={data}
            busy={busy}
            sync={() =>
              action(async () => setData(await rpc.call("sync", null)))
            }
            init={() =>
              action(async () => setData(await rpc.call("initTopics", null)))
            }
            syncMenu={() =>
              action(async () => setData(await rpc.call("syncMenu", null)))
            }
          />
        ) : tab === "events" ? (
          <>
            <ReportTab
              t={t}
              rpc={rpc}
              form={form}
              setForm={setForm}
              busy={busy}
              save={() => action(() => savePreferences(form))}
            />
            <EventsTab t={t} rpc={rpc} action={action} busy={busy} />
          </>
        ) : tab === "topics" ? (
          <TopicsTab
            t={t}
            rpc={rpc}
            form={form}
            setForm={setForm}
            data={data}
            busy={busy}
            save={() => action(() => savePreferences(form))}
          />
        ) : tab === "connection" ? (
          <ConnectionTab
            t={t}
            rpc={rpc}
            form={form}
            setForm={setForm}
            data={data}
            source={source}
            setSource={setSource}
            tokenEnv={tokenEnv}
            busy={busy}
            action={action}
            setNotice={setNotice}
            save={() => action(() => savePreferences(form))}
          />
        ) : (
          <GeneralTab
            t={t}
            form={form}
            setForm={setForm}
            busy={busy}
            save={() => action(() => savePreferences(form))}
          />
        )}
      </main>
    </div>
  );
}

function Section(props: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="tg-panel">
      <div className="tg-panel-head">
        <h2>{props.title}</h2>
        {props.aside}
      </div>
      <div className="tg-panel-body space-y-4">{props.children}</div>
    </section>
  );
}
function Toggle(props: {
  title: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <label className="tg-row flex gap-3 items-center justify-between py-3">
      <span className="min-w-0">
        <span className="block font-medium">{props.title}</span>
        {props.hint && (
          <span className="text-sm text-muted-foreground">{props.hint}</span>
        )}
        {props.children}
      </span>
      <input
        className="tg-switch"
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </label>
  );
}

function problem(code: string, t: T) {
  const known: Record<string, string> = {
    owner_not_paired: t(
      "Бот ещё не привязан к вашему Telegram: откройте вкладку «Подключение».",
      "The bot is not linked to your Telegram yet: open the Connection tab.",
    ),
    tasks_cli_unavailable: t(
      "Плагин Tasks выключен или недоступен: события задач не приходят. Отчёты агентов работают.",
      "The Tasks plugin is disabled or unavailable: task events are not delivered. Agent reports still work.",
    ),
    topics_not_initialized: t(
      "База плагина пустая, темы не созданы.",
      "The plugin database is empty; no topics yet.",
    ),
    bot_configuration_unavailable: t(
      "Нет токена бота: сохрани его на вкладке «Подключение» или добавь в Env Catalog.",
      "No bot token: save one on the Connection tab or add it to Env Catalog.",
    ),
    threaded_mode_disabled: t(
      "У бота выключен Threaded Mode в BotFather.",
      "Threaded Mode is off for the bot in BotFather.",
    ),
    telegram_409: t(
      "Сообщения бота читает другой процесс. Останови второй приёмник.",
      "Another process reads the bot's updates. Stop the second receiver.",
    ),
  };
  return known[code] ?? code;
}

function Overview(props: {
  t: T;
  data: any;
  busy: boolean;
  sync: () => void;
  init: () => void;
  syncMenu: () => void;
}) {
  const { t, data } = props;
  if (!data) return null;
  const problems = [data.error, data.chatError, data.ingressError].filter(
    Boolean,
  ) as string[];
  const stats: [string, string][] = [
    [
      t("Синхронизация", "Last sync"),
      data.lastSync
        ? new Date(data.lastSync).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        : "—",
    ],
    [t("Темы", "Topics"), String(data.topics.length)],
    [t("Очередь", "Queue"), String(data.queue + data.chatQueue)],
    [t("Задачи", "Tasks"), String(data.tasks)],
  ];
  return (
    <>
      <Section
        title={t("Состояние", "Status")}
        aside={
          <button
            className="tg-btn tg-accent"
            disabled={props.busy}
            onClick={props.sync}
          >
            {t("Синхронизировать", "Sync now")}
          </button>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stats.map(([label, value]) => (
            <div key={label} className="tg-inner">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-lg font-semibold">{value}</div>
            </div>
          ))}
        </div>
        {problems.length ? (
          <ul className="space-y-2">
            {problems.map((p) => (
              <li key={p} role="alert" className="tg-inner text-sm">
                <span className="tg-pill tg-pill-danger mr-2">!</span>
                {problem(p, t)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="tg-pill tg-pill-success">
            {t("Всё работает", "Everything works")}
          </p>
        )}
        {data.error === "topics_not_initialized" && (
          <div className="tg-inner space-y-2">
            <p className="text-sm">
              {t(
                "Если темы бота уже есть, привяжи их командой bb telegram-projects bind <project-id> <topic-id>, иначе создай набор тем.",
                "If the bot already has topics, bind them with bb telegram-projects bind <project-id> <topic-id>; otherwise create the topic set.",
              )}
            </p>
            <button
              className="tg-btn tg-accent"
              disabled={props.busy}
              onClick={props.init}
            >
              {t("Создать темы", "Create topics")}
            </button>
          </div>
        )}
      </Section>
      <Commands t={t} data={data} busy={props.busy} syncMenu={props.syncMenu} />
    </>
  );
}

const COMMAND_GROUPS: { id: BotCommand["group"]; ru: string; en: string }[] = [
  { id: "topics", ru: "Темы и проекты", en: "Topics and projects" },
  { id: "chat", ru: "Чат с агентом", en: "Chat with the agent" },
  { id: "agent", ru: "Настройка нового чата", en: "New chat setup" },
  { id: "tasks", ru: "Задачи", en: "Tasks" },
];
// What each command does, and whether Telegram's bot menu really shows it.
function Commands(props: {
  t: T;
  data: any;
  busy: boolean;
  syncMenu: () => void;
}) {
  const { t } = props;
  const served = new Set<string>(
    (props.data.menu ?? []).map((c: { command: string }) => c.command),
  );
  const missing = BOT_COMMANDS.filter((c) => !c.args && !served.has(c.command));
  const en = t("ru", "en") === "en";
  return (
    <Section
      title={t("Команды бота", "Bot commands")}
      aside={
        <span className="flex flex-wrap items-center gap-2">
          <span
            className={
              "tg-pill " +
              (missing.length ? "tg-pill-danger" : "tg-pill-success")
            }
          >
            {missing.length
              ? t("меню бота не совпадает", "bot menu differs")
              : t("меню бота синхронизировано", "bot menu in sync")}
          </span>
          <button
            className="tg-btn"
            disabled={props.busy}
            onClick={props.syncMenu}
          >
            {t("Обновить меню", "Update menu")}
          </button>
        </span>
      }
    >
      <p className="text-sm text-muted-foreground">
        {t(
          "Команды работают в теме проекта. Меню бота в Telegram строится из этого же списка; команды с параметром вводятся вручную.",
          "Commands work inside a project topic. The Telegram bot menu is built from this list; commands with a parameter are typed by hand.",
        )}
      </p>
      {COMMAND_GROUPS.map((g) => (
        <div key={g.id} className="space-y-1">
          <h3 className="text-sm font-semibold text-muted-foreground">
            {t(g.ru, g.en)}
          </h3>
          <ul>
            {BOT_COMMANDS.filter((c) => c.group === g.id).map((c) => (
              <li
                key={c.command}
                className="tg-row flex flex-wrap items-start justify-between gap-2 py-2"
              >
                <span className="min-w-0 flex-1">
                  <code className="tg-pill tg-pill-neutral mr-2">
                    /{c.command}
                    {c.args ? " " + c.args : ""}
                  </code>
                  <span className="font-medium">{en ? c.en : c.ru}</span>
                  <span className="block text-sm text-muted-foreground mt-1">
                    {en ? c.hintEn : c.hintRu}
                  </span>
                </span>
                <span
                  className={
                    "tg-pill " +
                    (c.args
                      ? "tg-pill-muted"
                      : served.has(c.command)
                        ? "tg-pill-success"
                        : "tg-pill-danger")
                  }
                >
                  {c.args
                    ? t("вручную", "typed")
                    : served.has(c.command)
                      ? t("в меню", "in menu")
                      : t("нет в меню", "not in menu")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Section>
  );
}

const GROUPS: {
  ru: string;
  en: string;
  kinds: [EventKind, string, string, string, string][];
}[] = [
  {
    ru: "Агенты",
    en: "Agents",
    kinds: [
      [
        "thread_done",
        "Агент закончил работу",
        "Agent finished",
        "Итог хода с подписью: проект, раздел, тред, агент.",
        "Turn result signed with project, section, thread and agent.",
      ],
      [
        "thread_attention",
        "Агент ждёт ответа",
        "Agent is waiting",
        "Вопрос или разрешение, без которого работа стоит.",
        "A question or approval that blocks the work.",
      ],
      [
        "thread_stopped",
        "Тред остановлен или упал",
        "Thread stopped or failed",
        "Остановка вручную или ошибка провайдера.",
        "Manual stop or a provider error.",
      ],
    ],
  },
  {
    ru: "Задачи",
    en: "Tasks",
    kinds: [
      [
        "task_done",
        "Задача завершена",
        "Task done",
        "Всё, что перешло в «Завершено».",
        "Everything moved to Done.",
      ],
      [
        "task_review",
        "Нужна проверка",
        "Needs review",
        "Исполнитель сдал работу на проверку.",
        "A worker handed the task in for review.",
      ],
      ["task_created", "Новая задача", "New task", "", ""],
      ["task_started", "Исполнитель начал работу", "Worker started", "", ""],
      [
        "task_status",
        "Другие смены статуса",
        "Other status changes",
        "В работе, отменена и так далее.",
        "In progress, canceled and so on.",
      ],
      ["task_due", "Изменён срок", "Due date changed", "", ""],
      [
        "worker_error",
        "Ошибка исполнителя",
        "Worker error",
        "Агент, прикреплённый к задаче, упал.",
        "An agent attached to a task failed.",
      ],
    ],
  },
];

// Full agent reply or a summary written by any BB model the user picks.
function ReportTab(props: {
  t: T;
  rpc: Rpc;
  form: Preferences;
  setForm: (f: Preferences) => void;
  busy: boolean;
  save: () => void;
}) {
  const { t, form, setForm } = props;
  const [defaults, setDefaults] = useState<PickerValue | null>(null);
  useEffect(() => {
    if (form.reportMode !== "summary" || form.summaryProvider) return;
    void props.rpc
      .call("summaryDefaults", null)
      .then((d) => setDefaults(d as PickerValue))
      .catch(() => {});
  }, [form.reportMode, form.summaryProvider]);
  const value: PickerValue | null = form.summaryProvider
    ? {
        providerId: form.summaryProvider,
        model: form.summaryModel,
        reasoningLevel: (form.summaryReasoning ||
          "medium") as PickerValue["reasoningLevel"],
        ...(form.summaryServiceTier
          ? {
              serviceTier:
                form.summaryServiceTier as PickerValue["serviceTier"],
            }
          : {}),
      }
    : defaults;
  const choose = (v: PickerValue) =>
    setForm({
      ...form,
      summaryProvider: v.providerId,
      summaryModel: v.model,
      summaryReasoning: v.reasoningLevel,
      summaryServiceTier: v.serviceTier ?? "",
    });
  return (
    <Section title={t("Содержимое отчёта агента", "Agent report content")}>
      <div className="tg-seg" role="tablist">
        {(["full", "summary"] as const).map((mode) => (
          <button
            key={mode}
            role="tab"
            aria-selected={form.reportMode === mode}
            className="tg-seg-item"
            onClick={() => setForm({ ...form, reportMode: mode })}
          >
            {mode === "full"
              ? t("Полный ответ", "Full reply")
              : t("Саммери", "Summary")}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {form.reportMode === "full"
          ? t(
              "В карточку попадает ответ агента целиком, свёрнутым блоком.",
              "The card carries the agent's whole reply in a collapsed block.",
            )
          : t(
              "Выбранная модель BB пишет 3–6 пунктов: что сделано, итог, что требует внимания. Модель работает в скрытом треде и только с текстом ответа. Если саммери не готово за 3 минуты, приходит полный ответ. Короткие ответы приходят как есть.",
              "The chosen BB model writes 3–6 points: what was done, the result, what needs attention. It runs in a hidden thread on the reply text only. If the summary is not ready within 3 minutes, the full reply is sent. Short replies are sent as is.",
            )}
      </p>
      {form.reportMode === "summary" && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium">
            {t("Модель для саммери", "Summary model")}
          </span>
          {value ? (
            <ProviderModelPicker value={value} onChange={choose} />
          ) : (
            <span className="text-sm text-muted-foreground">
              {t("Загружаю модели BB…", "Loading BB models…")}
            </span>
          )}
          {!form.summaryProvider && value && (
            <span className="text-sm text-muted-foreground">
              {t("модель BB по умолчанию", "BB default model")}
            </span>
          )}
        </div>
      )}
      <button
        className="tg-btn tg-accent"
        disabled={props.busy}
        onClick={props.save}
      >
        {t("Сохранить", "Save")}
      </button>
    </Section>
  );
}

function EventsTab(props: {
  t: T;
  rpc: Rpc;
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
}) {
  const { t, rpc } = props;
  const [state, setState] = useState<EventsData | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    void rpc.call("eventsGet", null).then((d) => setState(d as EventsData));
  }, []);
  if (!state) return null;
  const set = (k: EventKind, patch: Partial<Events[EventKind]>) => {
    setState({
      ...state,
      events: { ...state.events, [k]: { ...state.events[k], ...patch } },
    });
    setDirty(true);
  };
  return (
    <>
      {GROUPS.map((g) => (
        <Section key={g.ru} title={t(g.ru, g.en)}>
          <div>
            {g.kinds.map(([k, ru, eng, hru, hen]) => {
              const r = state.events[k];
              return (
                <Toggle
                  key={k}
                  title={t(ru, eng)}
                  hint={hru ? t(hru, hen) : undefined}
                  checked={r.on}
                  onChange={(on) => set(k, { on })}
                >
                  {r.on && (
                    <span className="flex flex-wrap gap-2 mt-2">
                      <button
                        type="button"
                        className={
                          "tg-pill " +
                          (r.sound ? "tg-pill-info" : "tg-pill-muted")
                        }
                        onClick={(e) => {
                          e.preventDefault();
                          set(k, { sound: !r.sound });
                        }}
                      >
                        {r.sound
                          ? t("🔔 со звуком", "🔔 with sound")
                          : t("🔕 без звука", "🔕 silent")}
                      </button>
                      <ProjectPicker
                        t={t}
                        projects={state.projects}
                        value={r.projects}
                        onChange={(projects) => set(k, { projects })}
                      />
                    </span>
                  )}
                </Toggle>
              );
            })}
          </div>
        </Section>
      ))}
      <div className="flex justify-end">
        <button
          className="tg-btn tg-accent"
          disabled={props.busy || !dirty}
          onClick={() =>
            void props.action(async () => {
              await rpc.call("eventsSave", state.events);
              setDirty(false);
            })
          }
        >
          {t("Сохранить события", "Save events")}
        </button>
      </div>
    </>
  );
}

function ProjectPicker(props: {
  t: T;
  projects: EventsData["projects"];
  value: string[] | null;
  onChange: (v: string[] | null) => void;
}) {
  const { t, value } = props;
  const label = !value
    ? t("все проекты", "all projects")
    : value.length === 0
      ? t("ни одного проекта", "no projects")
      : props.projects
          .filter((p) => value.includes(p.id))
          .map((p) => p.name)
          .join(", ");
  return (
    <details className="tg-picker" onClick={(e) => e.stopPropagation()}>
      <summary className="tg-pill tg-pill-neutral cursor-pointer">
        📂 {label}
      </summary>
      <div className="tg-inner mt-2 space-y-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!value}
            onChange={(e) => props.onChange(e.target.checked ? null : [])}
          />
          {t("Все проекты", "All projects")}
        </label>
        {props.projects.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={!value}
              checked={!value || value.includes(p.id)}
              onChange={(e) =>
                props.onChange(
                  e.target.checked
                    ? [...(value ?? []), p.id]
                    : (value ?? []).filter((x) => x !== p.id),
                )
              }
            />
            {p.name}
            {p.hidden && (
              <span className="tg-pill tg-pill-muted">
                {t("скрыт", "hidden")}
              </span>
            )}
          </label>
        ))}
      </div>
    </details>
  );
}

function TopicsTab(props: {
  t: T;
  rpc: Rpc;
  form: Preferences;
  setForm: (f: Preferences) => void;
  data: any;
  busy: boolean;
  save: () => void;
}) {
  const { t, form, data } = props;
  const [projects, setProjects] = useState<EventsData["projects"]>([]);
  useEffect(() => {
    void props.rpc
      .call("eventsGet", null)
      .then((d) => setProjects((d as EventsData).projects));
  }, []);
  const bindings: { topicId: number; projectId: string }[] =
    data?.chatBindings ?? [];
  const service = (data?.topics ?? []).filter(
    (x: any) => !x.key.startsWith("proj_"),
  );
  return (
    <>
      <Section title={t("Темы проектов", "Project topics")}>
        <ul className="space-y-2">
          {service.map((x: any) => (
            <li
              key={x.key}
              className="tg-inner flex items-center justify-between gap-2"
            >
              <span>{x.name}</span>
              <span className="tg-pill tg-pill-neutral">
                #{x.threadId ?? "—"}
              </span>
            </li>
          ))}
          {projects.map((p) => {
            const extra = bindings.filter(
              (b) => b.projectId === p.id && b.topicId !== p.topicId,
            ).length;
            return (
              <li
                key={p.id}
                className="tg-inner flex flex-wrap items-center justify-between gap-2"
              >
                <span className="font-medium">📂 {p.name}</span>
                <span className="flex flex-wrap gap-2">
                  {extra > 0 && (
                    <span className="tg-pill tg-pill-info">
                      +{extra} {t("доп. тем", "extra topics")}
                    </span>
                  )}
                  {p.hidden && form.hideWithFolders ? (
                    <span className="tg-pill tg-pill-muted">
                      {t(
                        "скрыт в Project Folders",
                        "hidden in Project Folders",
                      )}
                    </span>
                  ) : p.topicId ? (
                    <span className="tg-pill tg-pill-success">
                      #{p.topicId}
                    </span>
                  ) : (
                    <span className="tg-pill tg-pill-muted">
                      {t("темы нет", "no topic")}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title={t("Правила тем", "Topic rules")}>
        <div>
          <Toggle
            title={t(
              "Скрывать вместе с Project Folders",
              "Hide with Project Folders",
            )}
            hint={t(
              "Скрытый проект или раздел убирает свою тему из Telegram вместе с историей: в личном чате с ботом тему можно только удалить. Показал снова — тема создаётся заново.",
              "A hidden project or section removes its topic from Telegram with its history: a private bot chat can only delete topics. Show it again and a new topic is created.",
            )}
            checked={form.hideWithFolders}
            onChange={(v) => props.setForm({ ...form, hideWithFolders: v })}
          />
          <Toggle
            title={t(
              "Удалять темы удалённых проектов",
              "Delete topics of deleted projects",
            )}
            hint={t(
              "Удаляется и история темы Telegram. Отключи, чтобы сохранять её.",
              "Also deletes the Telegram topic history. Turn off to preserve it.",
            )}
            checked={form.deleteTopics}
            onChange={(v) => props.setForm({ ...form, deleteTopics: v })}
          />
        </div>
        <button
          className="tg-btn tg-accent"
          disabled={props.busy}
          onClick={props.save}
        >
          {t("Сохранить", "Save")}
        </button>
      </Section>
    </>
  );
}

function ConnectionTab(props: {
  t: T;
  rpc: Rpc;
  form: Preferences;
  setForm: (f: Preferences) => void;
  data: any;
  source: "manual" | "env" | "none";
  setSource: (s: "manual" | "env" | "none") => void;
  tokenEnv: string;
  busy: boolean;
  action: (fn: () => Promise<void>) => Promise<void>;
  setNotice: (s: string) => void;
  save: () => void;
}) {
  const { t, rpc, form, source } = props;
  const [token, setToken] = useState("");
  const [check, setCheck] = useState<Diagnosis | null>(null);
  return (
    <>
      <Section
        title={t("Бот", "Bot")}
        aside={
          <span
            className={
              "tg-pill " +
              (source !== "none" ? "tg-pill-success" : "tg-pill-danger")
            }
          >
            {source === "manual"
              ? t("токен задан вручную", "manual token")
              : source === "env"
                ? "Env Catalog · " + props.tokenEnv
                : t("токен не настроен", "token not configured")}
          </span>
        }
      >
        <p>
          {t("Бот", "Bot")}: {props.data?.bot ? "@" + props.data.bot : "—"}
        </p>
        <label className="block font-medium">
          {t("Заменить токен", "Replace token")}
          <input
            className="tg-input block w-full mt-2"
            type="password"
            autoComplete="new-password"
            value={token}
            placeholder={t(
              "Вставь токен из BotFather для проверки или замены",
              "Paste a BotFather token to check or replace",
            )}
            onChange={(e) => {
              setToken(e.target.value);
              setCheck(null);
            }}
          />
        </label>
        <p className="text-sm text-muted-foreground">
          {t(
            "Без ручного токена плагин берёт его из Env Catalog. Ручной токен хранится в секретах плагина и не возвращается в интерфейс.",
            "Without a manual token the plugin reads Env Catalog. A manual token is kept in plugin secrets and never returned to this page.",
          )}
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            className="tg-btn"
            disabled={props.busy}
            onClick={() =>
              void props.action(async () =>
                setCheck(
                  await rpc.call("checkConnection", {
                    ...(token.trim() ? { token: token.trim() } : {}),
                  }),
                ),
              )
            }
          >
            {t("Проверить подключение", "Check connection")}
          </button>
          <button
            className="tg-btn tg-accent"
            disabled={props.busy || !token.trim()}
            onClick={() =>
              void props.action(async () => {
                const d = await rpc.call("saveToken", { token: token.trim() });
                setCheck(d);
                if (d.valid && d.sameBot && !d.error && !d.webhook) {
                  setToken("");
                  props.setSource("manual");
                  props.setNotice(t("Токен сохранён.", "Token saved."));
                } else
                  props.setNotice(
                    t(
                      "Токен не сохранён. Исправь ошибки ниже.",
                      "Token not saved. Resolve the issues below.",
                    ),
                  );
              })
            }
          >
            {t("Проверить и сохранить токен", "Check and save token")}
          </button>
          {source === "manual" && (
            <button
              className="tg-btn"
              disabled={props.busy}
              onClick={() =>
                void props.action(async () =>
                  props.setSource(
                    (await rpc.call("useEnvToken", null)) ? "env" : "none",
                  ),
                )
              }
            >
              {t("Брать токен из Env Catalog", "Use the Env Catalog token")}
            </button>
          )}
        </div>
        {check && <Check t={t} check={check} />}
        <details className="tg-inner">
          <summary className="cursor-pointer font-medium">
            {t("Что включить в BotFather", "What to enable in BotFather")}
          </summary>
          <div className="mt-3 space-y-2 text-sm">
            <p>
              <b>Threaded Mode: ON.</b>{" "}
              {t(
                "Обязательно для тем проектов.",
                "Required for project topics.",
              )}
            </p>
            <p>
              <b>Disallow users to create new threads: OFF.</b>{" "}
              {t(
                "Для новых тем вручную и команды /project.",
                "For manually created topics and /project.",
              )}
            </p>
            <p>
              <b>Restrict bot usage.</b>{" "}
              {t(
                "Можно включить для личного доступа. API не раскрывает эту настройку; проверь вручную.",
                "Optional for personal access. The API does not expose this setting; check it manually.",
              )}
            </p>
            <p>
              {t(
                "Открой личный чат с ботом и нажми Start.",
                "Open the bot’s private chat and press Start.",
              )}
            </p>
            <a
              className="underline"
              href="https://core.telegram.org/bots/api#user"
              target="_blank"
              rel="noreferrer"
            >
              Telegram Bot API ↗
            </a>
          </div>
        </details>
      </Section>
      <Owner t={t} rpc={rpc} busy={props.busy} action={props.action} />
      <Section title={t("Ссылки в сообщениях", "Links in messages")}>
        <label className="block font-medium">
          {t("Публичный адрес BB", "Public BB URL")}
          <input
            type="url"
            className="tg-input block w-full mt-2"
            value={form.appUrl}
            onChange={(e) => props.setForm({ ...form, appUrl: e.target.value })}
          />
        </label>
        <button
          className="tg-btn tg-accent"
          disabled={props.busy}
          onClick={props.save}
        >
          {t("Сохранить", "Save")}
        </button>
      </Section>
    </>
  );
}

// Only the person who sends the page's one-time code to the bot can use it.
function Owner(props: {
  t: T;
  rpc: Rpc;
  busy: boolean;
  action: (fn: () => Promise<void>) => Promise<void>;
}) {
  const { t, rpc } = props;
  const [pair, setPair] = useState<{
    owner: number | null;
    code: string | null;
    link: string | null;
  } | null>(null);
  const load = () =>
    rpc
      .call("pairing", null)
      .then(setPair)
      .catch(() => {});
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, []);
  if (!pair) return null;
  return (
    <Section
      title={t("Владелец", "Owner")}
      aside={
        <span
          className={
            "tg-pill " + (pair.owner ? "tg-pill-success" : "tg-pill-danger")
          }
        >
          {pair.owner
            ? t("привязан", "linked")
            : t("не привязан", "not linked")}
        </span>
      }
    >
      {pair.owner ? (
        <>
          <p>
            {t(
              "Бот отвечает только этому аккаунту Telegram",
              "The bot answers only this Telegram account",
            )}
            : <code>{pair.owner}</code>
          </p>
          <button
            className="tg-btn"
            disabled={props.busy}
            onClick={() =>
              void props.action(async () => {
                await rpc.call("unpair", null);
                await load();
              })
            }
          >
            {t("Отвязать", "Unlink")}
          </button>
        </>
      ) : (
        <ol className="list-decimal pl-5 space-y-1 text-sm">
          <li>
            {t(
              "Сохраните токен бота выше и включите «Синхронизацию проектов» на вкладке «Общие».",
              "Save the bot token above and turn on Project sync on the General tab.",
            )}
          </li>
          <li>
            {pair.link ? (
              <>
                {t(
                  "Откройте ссылку и нажмите Start",
                  "Open the link and press Start",
                )}
                :{" "}
                <a
                  className="underline"
                  href={pair.link}
                  target="_blank"
                  rel="noreferrer"
                >
                  {pair.link}
                </a>
              </>
            ) : (
              t(
                "Откройте личный чат с ботом.",
                "Open a private chat with the bot.",
              )
            )}
          </li>
          <li>
            {t("Или отправьте боту команду", "Or send the bot")}{" "}
            <code className="tg-pill tg-pill-neutral">/start {pair.code}</code>
          </li>
          <li>
            {t(
              "Бот ответит «Бот привязан к BB», и эта страница обновится сама.",
              "The bot replies that it is linked to BB, and this page updates by itself.",
            )}
          </li>
        </ol>
      )}
    </Section>
  );
}

function Check({ t, check }: { t: T; check: Diagnosis }) {
  return (
    <div className="tg-inner space-y-2" aria-live="polite">
      <p>
        {check.valid ? "✅" : "❌"} {t("Токен", "Token")}
        {check.username ? " · @" + check.username : ""}
      </p>
      {check.valid && (
        <>
          <p>
            {check.sameBot ? "✅" : "❌"}{" "}
            {t("Совпадает с подключённым ботом", "Matches the connected bot")}
          </p>
          <p>
            {check.topics ? "✅" : "❌"} Threaded Mode —{" "}
            {check.topics
              ? t("включён", "enabled")
              : t(
                  "включи в BotFather → Bot Settings → Threads Settings",
                  "enable in BotFather → Bot Settings → Threads Settings",
                )}
          </p>
          <p>
            {check.userTopics ? "✅" : "⚠️"}{" "}
            {t("Создание тем пользователем", "User-created topics")} —{" "}
            {!check.userTopics
              ? t(
                  "отключи Disallow users to create new threads, чтобы создавать темы вручную",
                  "turn off Disallow users to create new threads to create topics manually",
                )
              : t("разрешено", "allowed")}
          </p>
          <p>
            {check.error ? "⚠️" : check.webhook ? "❌" : "✅"}{" "}
            {check.error
              ? t("Webhook: проверка не завершена", "Webhook: check incomplete")
              : check.webhook
                ? t(
                    "Установлен webhook. Приёмник использует polling: сначала отключи webhook в прежней интеграции.",
                    "A webhook is configured. This receiver uses polling: disable the webhook in the previous integration first.",
                  )
                : t(
                    "Webhook не мешает приёму сообщений",
                    "No webhook conflicts with message polling",
                  )}
          </p>
        </>
      )}
      {check.error && (
        <p>
          {t(
            "Проверка не завершена: проверь токен и доступ сервера к Telegram.",
            "Check incomplete: verify the token and server access to Telegram.",
          )}
        </p>
      )}
    </div>
  );
}

function GeneralTab(props: {
  t: T;
  form: Preferences;
  setForm: (f: Preferences) => void;
  busy: boolean;
  save: () => void;
}) {
  const { t, form, setForm } = props;
  return (
    <Section title={t("Общие", "General")}>
      <label className="flex items-center justify-between gap-3 font-medium">
        {t("Язык интерфейса и бота", "Interface and bot language")}
        <select
          className="tg-input"
          value={form.language}
          onChange={(e) =>
            setForm({ ...form, language: e.target.value as "ru" | "en" })
          }
        >
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </select>
      </label>
      <p className="text-sm text-muted-foreground">
        {t(
          "Язык новых меню и служебных сообщений. Существующая история и ответы агентов не переводятся.",
          "Language of new menus and service messages. Existing history and agent replies are not translated.",
        )}
      </p>
      <div>
        <Toggle
          title={t("Синхронизация проектов", "Project sync")}
          hint={t(
            "Главный выключатель: темы, события и приём сообщений.",
            "Main switch: topics, events and message receiving.",
          )}
          checked={form.enabled}
          onChange={(v) => setForm({ ...form, enabled: v })}
        />
        <Toggle
          title={t("Общение с BB", "Chat with BB")}
          hint={t(
            "Сообщения и голос из подключённой темы поступают в чат BB.",
            "Text and voice from connected topics go to the BB chat.",
          )}
          checked={form.chatEnabled}
          onChange={(v) => setForm({ ...form, chatEnabled: v })}
        />
        <Toggle
          title={t("Оформленные ответы", "Rich replies")}
          hint={t(
            "Rich Messages с форматированием; обычный текст при несовместимости.",
            "Rich Messages with formatting; plain text fallback.",
          )}
          checked={form.richReplies}
          onChange={(v) => setForm({ ...form, richReplies: v })}
        />
      </div>
      <label className="block font-medium">
        {t("Часовой пояс", "Time zone")}
        <input
          className="tg-input block w-full mt-2"
          value={form.timeZone}
          placeholder={t(
            "Например, Europe/Moscow. Пусто — часовой пояс сервера BB",
            "For example, Europe/London. Empty uses the BB server's zone",
          )}
          onChange={(e) =>
            setForm({ ...form, timeZone: e.target.value.trim() })
          }
        />
      </label>
      <details className="tg-inner">
        <summary className="cursor-pointer font-medium">
          {t("Дополнительно", "Advanced")}
        </summary>
        <div className="mt-3 space-y-3">
          <Toggle
            title={t("Тема SMS", "SMS topic")}
            hint={t(
              "Отдельная тема для сервиса-компаньона, который пересылает SMS. Без компаньона не нужна.",
              "A separate topic for a companion service that forwards SMS. Not needed without one.",
            )}
            checked={form.smsTopic}
            onChange={(v) => setForm({ ...form, smsTopic: v })}
          />
          <label className="block font-medium">
            {t("Папка компаньона на сервере", "Companion folder on the server")}
            <input
              className="tg-input block w-full mt-2"
              value={form.companionDir}
              placeholder={t(
                "Пусто — компаньон не используется",
                "Empty: no companion service",
              )}
              onChange={(e) =>
                setForm({ ...form, companionDir: e.target.value.trim() })
              }
            />
            <span className="block text-sm text-muted-foreground mt-1">
              {t(
                "Плагин пишет туда список тем для компаньона и читает его входящие сообщения.",
                "The plugin writes its topic list there and reads the companion's incoming messages.",
              )}
            </span>
          </label>
        </div>
      </details>
      <button
        className="tg-btn tg-accent"
        disabled={props.busy}
        onClick={props.save}
      >
        {t("Сохранить", "Save")}
      </button>
    </Section>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "telegram-projects",
    title: "Telegram",
    icon: "MessageSquare",
    path: "telegram-projects",
    component: Panel,
  });
});
