import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
  TelegramFailure,
  type Task,
  type TaskStatus,
  type Telegram,
} from "./model";
const exec = promisify(execFile);
export type TokenSource = () => Promise<string>;
export function telegram(
  token: TokenSource,
  signal: AbortSignal,
  timeoutMs = 15_000,
  /** The paired owner's private chat; every chat method targets it. */
  owner: () => number | undefined = () => undefined,
): Telegram {
  return async <T>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> => {
    const secret = await token();
    let r: Response;
    try {
      r = await fetch(`https://api.telegram.org/bot${secret}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...Object.fromEntries(Object.entries(body).filter(([key]) => key !== "strangerChatId")),
          ...(typeof body.strangerChatId === "number" ? { chat_id: body.strangerChatId } : method === "getMe" ||
          method === "getUpdates" ||
          method === "setMyCommands" ||
          method === "setMyDescription" ||
          method === "setMyShortDescription"
            ? {}
            : { chat_id: owner() }),
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
    } catch {
      throw new TelegramFailure("telegram_network", 30, true);
    }
    let data: any;
    try {
      data = await r.json();
    } catch {
      throw new TelegramFailure("telegram_invalid_response", 30, true);
    }
    if (!data.ok) {
      const d = String(data.description ?? "");
      if (
        d.includes("TOPIC_NOT_MODIFIED") ||
        d.includes("message is not modified")
      )
        return true as T;
      const code =
        d.includes("TOPIC_ID_INVALID") || d.includes("message thread not found")
          ? "topic_missing"
          : `telegram_${data.error_code ?? r.status}`;
      throw new TelegramFailure(
        code,
        Number(data.parameters?.retry_after) || 30,
        r.status >= 500,
      );
    }
    return data.result as T;
  };
}
// Env Catalog prints the stored value; the trailing newline is not part of it.
export async function readEnvToken(
  binary: string,
  baseUrl: string,
  name: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, BB_SERVER_URL: baseUrl };
    const r = await exec(binary, ["env-catalog", "get", name, "--raw"], {
      env,
      timeout: 15_000,
      signal,
    });
    return r.stdout.trim();
  } catch {
    return "";
  }
}
// The first bot seen is remembered; a token of another bot is refused afterwards,
// because topics and bindings belong to the bot that created them.
export async function checkBot(tg: Telegram, expected?: number) {
  const me = await tg("getMe", {});
  if (expected && me.id !== expected) throw new Error("unexpected_bot_identity");
  return {
    id: Number(me.id),
    username: String(me.username),
    topics: me.has_topics_enabled === true,
  };
}
export type LaneRpc = (method: string, input: unknown) => Promise<unknown>;
const runsPageSchema = z.object({
  runs: z.array(
    z
      .object({
        id: z.string(),
        state: z.string(),
        updated_at: z.number(),
        attempts: z.array(
          z
            .object({
              id: z.string(),
              state: z.string(),
              attempt_no: z.number(),
              task_id: z.string(),
              reason: z.string().nullable(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
  ),
});
const runCardSchema = z
  .object({ tasks: z.array(z.object({ id: z.string(), title: z.string() }).passthrough()) })
  .passthrough()
  .nullable();
// An attempt that is still working or being retried counts as in progress; only "queued" is waiting.
export function statusOf(attemptState: string): TaskStatus {
  if (attemptState === "accepted") return "done";
  if (attemptState === "canceled") return "canceled";
  if (attemptState === "blocked") return "blocked";
  return attemptState === "queued" ? "todo" : "in_progress";
}
/**
 * Reads a project's Lane Pilot tasks over the plugin RPC: `list_runs` for the newest and every open run
 * (task = its latest attempt), `get_run_card` for task titles, which never change and are cached.
 */
export function lanePilotReader(rpc: LaneRpc, pageSize = 10, now = () => Date.now()) {
  const titles = new Map<string, string>();
  return async function read(projectId: string): Promise<Task[]> {
    const { runs } = runsPageSchema.parse(
      await rpc("list_runs", { projectId, offset: 0, limit: pageSize, pinOpen: true }),
    );
    const tasks: Task[] = [];
    for (const run of runs) {
      const latest = new Map<string, (typeof run.attempts)[number]>();
      for (const a of run.attempts) {
        const seen = latest.get(a.task_id);
        if (!seen || a.attempt_no >= seen.attempt_no) latest.set(a.task_id, a);
      }
      // A finished run cannot gain titles it did not need an hour ago.
      const live = !["closed", "accepted"].includes(run.state) || run.updated_at > now() - 3_600_000;
      if (live && [...latest.keys()].some((id) => !titles.has(run.id + ":" + id)))
        try {
          const card = runCardSchema.parse(await rpc("get_run_card", { runId: run.id }));
          for (const t of card?.tasks ?? []) titles.set(run.id + ":" + t.id, t.title);
        } catch {
          // Without a card the task id is the title.
        }
      for (const [id, a] of latest)
        tasks.push({
          id,
          runId: run.id,
          title: titles.get(run.id + ":" + id) ?? id,
          status: statusOf(a.state),
          attemptId: a.id,
          reason: a.state === "blocked" ? (a.reason ?? "").slice(0, 300) || null : null,
          runUpdatedAt: run.updated_at,
        });
    }
    if (titles.size > 5000) titles.clear();
    return tasks;
  };
}

export async function transcribeTelegramVoice(
  token: TokenSource,
  sdk: import("@get-bb/plugin-sdk").BbPluginApi["sdk"],
  voice: { fileId: string; mime: string; size: number; duration: number },
  signal: AbortSignal,
): Promise<string> {
  if (voice.size > 15_000_000 || voice.duration > 600)
    throw Error("voice_too_large");
  const file = await telegram(token, signal)("getFile", {
    file_id: voice.fileId,
  });
  if (
    typeof file.file_path !== "string" ||
    !/^[a-zA-Z0-9_/.\-]+$/.test(file.file_path) ||
    file.file_path.includes("..")
  )
    throw Error("voice_file_invalid");
  const response = await fetch(
    `https://api.telegram.org/file/bot${await token()}/${file.file_path}`,
    { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) },
  ).catch(() => {
    throw Error("voice_download_failed");
  });
  if (
    !response.ok ||
    Number(response.headers.get("content-length")) > 15_000_000
  )
    throw Error("voice_download_failed");
  const reader = response.body!.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 15_000_000) {
      await reader.cancel();
      throw Error("voice_too_large");
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  const result = await sdk.system.transcribeVoice({
    file: new Blob([bytes], { type: voice.mime }),
    signal,
  });
  const text = (result as { text?: string }).text;
  if (!text?.trim() || text.length > 16000)
    throw Error("voice_transcription_empty");
  return text;
}
