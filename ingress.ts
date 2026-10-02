import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { OWNER_ID } from "./model";
import type { ChatInput } from "./chat";

export type Ingress =
  | { kind: "chat"; input: ChatInput; callbackId?: string }
  | { kind: "tasks"; topicId: number }
  | { kind: "ignore"; callbackId?: string };

// The plugin is the bot's only getUpdates receiver. The owner gate precedes everything:
// groups and other users are ignored, exactly as in the former companion receiver.
export function routeUpdate(u: any): Ingress {
  const cq = u?.callback_query;
  const m = cq ? cq.message : u?.message;
  const from = cq ? cq.from : u?.message?.from;
  const callbackId = cq ? String(cq.id) : undefined;
  if (
    !m ||
    from?.id !== OWNER_ID ||
    m.chat?.id !== OWNER_ID ||
    m.chat?.type !== "private"
  )
    return { kind: "ignore", callbackId };
  const callback: string | undefined = cq?.data;
  if (callback && !callback.startsWith("bb:"))
    return { kind: "ignore", callbackId };
  const text: string | undefined =
    typeof m.text === "string"
      ? m.text
      : m.forum_topic_created
        ? "/project"
        : undefined;
  const topicId = m.message_thread_id ?? 0;
  if (!callback && text?.match(/^\/tasks(?:@\w+)?(?:\s|$)/))
    return { kind: "tasks", topicId };
  if (!callback && !text && !m.voice && !m.audio && !m.document && !m.photo)
    return { kind: "ignore" };
  const v = m.voice ?? m.audio;
  return {
    kind: "chat",
    callbackId,
    input: {
      updateId: u.update_id,
      ownerId: OWNER_ID,
      chatId: OWNER_ID,
      topicId,
      messageId: m.message_id,
      text: callback ? undefined : text?.slice(0, 16000),
      callback,
      replyTo: m.reply_to_message?.message_id,
      voice: v
        ? {
            fileId: v.file_id,
            mime: v.mime_type ?? "audio/ogg",
            size: v.file_size ?? 0,
            duration: v.duration ?? 0,
          }
        : undefined,
    },
  };
}

// Durable hand-off to the chat bridge: atomic file and fsync, as the companion did.
export function writeSpool(dir: string, input: ChatInput) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, input.updateId + ".json");
  if (existsSync(path)) return;
  const temp = path + ".tmp";
  const fd = openSync(temp, "w", 0o600);
  try {
    writeSync(fd, JSON.stringify(input));
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
}
