import type { ChatInput } from "./chat";

export type Ingress =
  | { kind: "chat"; input: ChatInput; callbackId?: string }
  | { kind: "tasks"; topicId: number }
  | { kind: "pair"; userId: number }
  | { kind: "ignore"; callbackId?: string };

// The plugin is the bot's only getUpdates receiver. The owner gate precedes everything:
// groups and other users are ignored. Before pairing, only "/start <code>" in a
// private chat is accepted, and only with the code shown on the plugin page.
export function routeUpdate(
  u: any,
  owner: number | undefined,
  pairCode?: string,
): Ingress {
  const cq = u?.callback_query;
  const m = cq ? cq.message : u?.message;
  const from = cq ? cq.from : u?.message?.from;
  const callbackId = cq ? String(cq.id) : undefined;
  if (!m || m.chat?.type !== "private" || from?.id !== m.chat?.id)
    return { kind: "ignore", callbackId };
  if (owner === undefined) {
    const code = /^\/start(?:@\w+)?\s+(\S+)\s*$/.exec(m.text ?? "")?.[1];
    return !cq && pairCode && code === pairCode
      ? { kind: "pair", userId: from.id }
      : { kind: "ignore", callbackId };
  }
  if (from.id !== owner) return { kind: "ignore", callbackId };
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
      ownerId: owner,
      chatId: owner,
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
