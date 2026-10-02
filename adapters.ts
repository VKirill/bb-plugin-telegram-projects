import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
  TelegramFailure,
  taskSchema,
  type Task,
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
          ...body,
          ...(method === "getMe" ||
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
export async function runBb(
  binary: string,
  baseUrl: string,
  args: string[],
  signal: AbortSignal,
): Promise<unknown> {
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, BB_SERVER_URL: baseUrl };
    delete env.BB_PROJECT_ID;
    delete env.BB_THREAD_ID;
    delete env.BB_ENVIRONMENT_ID;
    const r = await exec(binary, args, {
      env,
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      signal,
    });
    return JSON.parse(r.stdout);
  } catch {
    throw new Error("tasks_cli_unavailable");
  }
}
export const trackersSchema = z.object({
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      linkedBbProjectId: z.string().nullable(),
    }),
  ),
});
export async function readTasks(
  run: (args: string[]) => Promise<unknown>,
  id: string,
): Promise<Task[]> {
  const tasks: Task[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const page = z
      .object({ tasks: z.array(taskSchema), nextCursor: z.string().nullable() })
      .parse(
        await run([
          "tasks",
          "list",
          "--project",
          id,
          "--limit",
          "500",
          "--json",
          ...(cursor ? ["--cursor", cursor] : []),
        ]),
      );
    tasks.push(...page.tasks);
    cursor = page.nextCursor;
    if (cursor) {
      if (seen.has(cursor) || tasks.length > 50_000)
        throw new Error("tasks_pagination_invalid");
      seen.add(cursor);
    }
  } while (cursor);
  return tasks;
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
