import test from "node:test";
import assert from "node:assert/strict";
import { diagnose, persistToken, savedToken } from "../settings";
import { translate, english } from "../companion/aivech/src/locale";
import { mkdtempSync, writeFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { BOT_ID, OWNER_ID } from "../model";
const token = "123456:" + "a".repeat(30);
test("diagnostics are read only, expose flags and never token or webhook URL", async () => {
  const methods: string[] = [];
  const result = await diagnose(token, async (url: any) => {
    methods.push(String(url).split("/").at(-1)!);
    return Response.json({
      ok: true,
      result:
        methods.length === 1
          ? {
              id: BOT_ID,
              username: "test",
              has_topics_enabled: true,
              allows_users_to_create_topics: false,
            }
          : { url: "https://private.example/secret" },
    });
  });
  assert.deepEqual(methods, ["getMe", "getWebhookInfo"]);
  assert.equal(result.valid, true);
  assert.equal(result.sameBot, true);
  assert.equal(result.topics, true);
  assert.equal(result.userTopics, false);
  assert.equal(result.webhook, true);
  assert.ok(!JSON.stringify(result).includes(token));
  assert.ok(!JSON.stringify(result).includes("private.example"));
});
test("invalid, rejected and foreign bot tokens are distinguished", async () => {
  assert.equal((await diagnose("bad")).error, "invalid_token");
  assert.equal(
    (await diagnose(token, async () => Response.json({ ok: false }))).valid,
    false,
  );
  assert.equal(
    (
      await diagnose(token, async () =>
        Response.json({ ok: true, result: { id: 1 } }),
      )
    ).sameBot,
    false,
  );
});
test("credential replacement preserves owner/config and mode 0600", () => {
  const root = mkdtempSync(tmpdir() + "/tg-settings-");
  try {
    const file = root + "/bot.json";
    writeFileSync(
      file,
      JSON.stringify({ chat_id: OWNER_ID, enabled: true, token: "old" }),
    );
    persistToken(file, token);
    assert.equal(savedToken(file), token);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("English translations preserve external names and Russian remains exact", () => {
  assert.ok(Object.values(english).every(Boolean));
  assert.equal(translate("en", "✚ Новый чат"), "✚ New chat");
  assert.equal(translate("ru", "✚ Новый чат"), "✚ Новый чат");
  assert.equal(
    translate("en", "Проект пользователя — Модель X"),
    "Проект пользователя — Модель X",
  );
});
