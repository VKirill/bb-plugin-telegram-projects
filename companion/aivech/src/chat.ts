import {
  existsSync,
  readFileSync,
  mkdirSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import type { Context } from "grammy";
export const CHAT_ROOT = "/Users/vechkasov/toolkit/service-bots/private";
export function chatEnabled(root = CHAT_ROOT) {
  try {
    const c = JSON.parse(
      readFileSync(join(root, "telegram-chat.json"), "utf8"),
    );
    return c.enabled === true;
  } catch {
    return false;
  }
}
// Retain updates while BB is restarting: the last explicit enabled flag is authoritative.
export function saveChatUpdate(ctx: Context, root = CHAT_ROOT) {
  const m = ctx.msg;
  if (!m) return false;
  const callback = ctx.callbackQuery?.data;
  if (callback && !callback.startsWith("bb:")) return false;
  const text =
    "text" in m ? m.text : "forum_topic_created" in m ? "/project" : undefined;
  if (!callback && text?.match(/^\/tasks(?:@\w+)?(?:\s|$)/)) return false;
  if (
    !callback &&
    !text &&
    !("voice" in m) &&
    !("audio" in m) &&
    !("document" in m) &&
    !("photo" in m)
  )
    return false;
  const v = "voice" in m ? m.voice : "audio" in m ? m.audio : undefined;
  const record = {
    updateId: ctx.update.update_id,
    ownerId: ctx.from!.id,
    chatId: ctx.chat!.id,
    topicId: m.message_thread_id ?? 0,
    messageId: m.message_id,
    text: callback ? undefined : text?.slice(0, 16000),
    callback,
    replyTo:
      "reply_to_message" in m ? m.reply_to_message?.message_id : undefined,
    voice: v
      ? {
          fileId: v.file_id,
          mime: v.mime_type ?? "audio/ogg",
          size: v.file_size ?? 0,
          duration: v.duration,
        }
      : undefined,
  };
  const dir = join(root, "bb-chat-inbox");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, record.updateId + ".json");
  if (existsSync(path)) return true;
  const temp = path + ".tmp";
  const fd = openSync(temp, "w", 0o600);
  try {
    writeSync(fd, JSON.stringify(record));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  const directory = openSync(dir, "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
  return true;
}
