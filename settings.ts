import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { BOT_ID, OWNER_ID } from "./model";
export const preferencesSchema = z
  .object({
    language: z.enum(["ru", "en"]),
    enabled: z.boolean(),
    chatEnabled: z.boolean(),
    richReplies: z.boolean(),
    deleteTopics: z.boolean(),
    notifyTasks: z.boolean(),
    notifyWorkerErrors: z.boolean(),
    soundOnReview: z.boolean(),
    appUrl: z
      .string()
      .url()
      .refine((v) => new URL(v).protocol === "https:", "https_required"),
  })
  .strict();
export const diagnosisSchema = z.object({
  valid: z.boolean(),
  sameBot: z.boolean(),
  username: z.string(),
  topics: z.boolean(),
  userTopics: z.boolean(),
  webhook: z.boolean(),
  error: z.string().nullable(),
});
export type Diagnosis = z.infer<typeof diagnosisSchema>;
export function savedToken(file: string): string {
  try {
    const c = JSON.parse(readFileSync(file, "utf8"));
    return typeof c.token === "string" ? c.token : "";
  } catch {
    return "";
  }
}
export async function diagnose(
  token: string,
  request: typeof fetch = fetch,
): Promise<Diagnosis> {
  const d: Diagnosis = {
    valid: false,
    sameBot: false,
    username: "",
    topics: false,
    userTopics: false,
    webhook: false,
    error: null,
  };
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token))
    return { ...d, error: "invalid_token" };
  async function call(method: string) {
    try {
      const r = await request(
        `https://api.telegram.org/bot${token}/${method}`,
        { method: "POST", signal: AbortSignal.timeout(15000) },
      );
      const data = (await r.json()) as any;
      if (!data.ok) throw 0;
      return data.result;
    } catch {
      throw new Error("telegram_check_failed");
    }
  }
  try {
    const me = await call("getMe");
    d.valid = true;
    d.sameBot = me.id === BOT_ID;
    d.username = String(me.username ?? "");
    d.topics = me.has_topics_enabled === true;
    d.userTopics = me.allows_users_to_create_topics === true;
    const wh = await call("getWebhookInfo");
    d.webhook = Boolean(wh.url);
  } catch {
    d.error = "telegram_check_failed";
  }
  return d;
}
// Credentials are never returned by RPC. Existing protected configuration is shared with the receiver.
export function persistToken(file: string, token: string) {
  const c = JSON.parse(readFileSync(file, "utf8"));
  if (c.chat_id !== OWNER_ID) throw new Error("unexpected_owner");
  const tmp = file + "." + randomUUID() + ".tmp";
  writeFileSync(tmp, JSON.stringify({ ...c, token }), {
    mode: 0o600,
    flag: "wx",
  });
  renameSync(tmp, file);
}
