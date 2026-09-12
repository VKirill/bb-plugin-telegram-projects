import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBot, OWNER_ID, BOT_ID } from "../dist/bot.js";
import { saveChatUpdate } from "../dist/chat.js";
test("owner-only durable ingress preserves topic, reply and callback; Tasks stays in companion", async () => {
  const root = mkdtempSync(join(tmpdir(), "bb-ingress-"));
  const replies = [];
  try {
    const bot = createBot("dummy", () => "", {
      enabled: () => true,
      save: (ctx) => saveChatUpdate(ctx, root),
    });
    bot.api.config.use(async (_prev, method, payload) => {
      if (method === "getMe")
        return {
          ok: true,
          result: { id: BOT_ID, is_bot: true, first_name: "Bot" },
        };
      replies.push({ method, payload });
      return {
        ok: true,
        result: { message_id: 9, chat: { id: OWNER_ID, type: "private" } },
      };
    });
    await bot.init();
    const msg = {
      message_id: 3,
      message_thread_id: 777,
      date: 1,
      from: { id: OWNER_ID, is_bot: false, first_name: "Owner" },
      chat: { id: OWNER_ID, type: "private" },
      text: "Привет",
      reply_to_message: { message_id: 2 },
    };
    await bot.handleUpdate({ update_id: 1, message: msg });
    await bot.handleUpdate({ update_id: 1, message: msg });
    assert.equal(readdirSync(join(root, "bb-chat-inbox")).length, 1);
    const saved = JSON.parse(
      readFileSync(join(root, "bb-chat-inbox/1.json"), "utf8"),
    );
    assert.equal(saved.topicId, 777);
    assert.equal(saved.replyTo, 2);
    assert.equal(
      statSync(join(root, "bb-chat-inbox/1.json")).mode & 0o777,
      0o600,
    );
    await bot.handleUpdate({
      update_id: 2,
      message: { ...msg, from: { id: 22, is_bot: false, first_name: "Other" } },
    });
    assert.equal(readdirSync(join(root, "bb-chat-inbox")).length, 1);
    await bot.handleUpdate({
      update_id: 3,
      callback_query: {
        id: "cb",
        chat_instance: "private",
        from: msg.from,
        message: {
          ...msg,
          from: { id: BOT_ID, is_bot: true, first_name: "Bot" },
        },
        data: "bb:abc",
      },
    });
    assert.equal(
      JSON.parse(readFileSync(join(root, "bb-chat-inbox/3.json"), "utf8"))
        .callback,
      "bb:abc",
    );
    assert.ok(replies.some((r) => r.method === "answerCallbackQuery"));
    await bot.handleUpdate({
      update_id: 4,
      message: {
        ...msg,
        text: "/tasks",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    });
    assert.equal(readdirSync(join(root, "bb-chat-inbox")).length, 2);
    assert.ok(replies.some((r) => r.method === "sendMessage"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
