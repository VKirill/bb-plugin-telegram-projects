import { tr } from "./locale.js";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { resolve } from "node:path";
import { GrammyError } from "grammy";
import { createBot, OWNER_ID, BOT_ID } from "./bot.js";
import { formatSms, type Sms } from "./sms.js";
import { smsTopic } from "./projects.js";

async function main() {
  process.umask(0o077);
  const ROOT = "/Users/vechkasov/toolkit/service-bots";
  const SMS_ROOT = "/Users/vechkasov/toolkit/novofon-sms";
  const cfg = JSON.parse(
    readFileSync(resolve(ROOT, "private/aivech.json"), "utf8"),
  );
  if (cfg.chat_id !== OWNER_ID || !cfg.enabled || typeof cfg.token !== "string")
    throw new Error("Invalid private bot configuration");
  const inbox = new DatabaseSync(resolve(SMS_ROOT, "private/inbox.sqlite3"), {
    readOnly: true,
    timeout: 5000,
  });
  const outbox = new DatabaseSync(
    resolve(ROOT, "private/aivech-outbox.sqlite3"),
    { timeout: 5000 },
  );
  outbox.exec(
    "PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS delivery (fingerprint TEXT PRIMARY KEY, received REAL, sent_at REAL, message_id INTEGER, attempts INTEGER DEFAULT 0, next_attempt REAL DEFAULT 0)",
  );
  chmodSync(resolve(ROOT, "private/aivech-outbox.sqlite3"), 0o600);
  const statusFile = resolve(ROOT, "private/aivech-status.json");
  let stopping = false;
  const tokenWatch = setInterval(() => {
    try {
      if (
        JSON.parse(readFileSync(resolve(ROOT, "private/aivech.json"), "utf8"))
          .token !== cfg.token
      )
        process.kill(process.pid, "SIGTERM");
    } catch {}
  }, 2000);
  tokenWatch.unref();
  let lastSent: number | null = null;
  let lastError: string | null = null;
  function status() {
    const n = outbox
      .prepare("SELECT COUNT(*) AS n FROM delivery WHERE sent_at IS NULL")
      .get()?.n;
    return (
      tr(
        "✅ Бот работает на Mac mini\n📱 SMS: Новофон → Mini → Telegram\n🔒 Только твой личный чат\nВ очереди: ",
      ) +
      String(n ?? 0) +
      tr("\nПоследняя ошибка: ") +
      String(lastError ?? tr("нет")) +
      ""
    );
  }
  function receipt() {
    writeFileSync(
      statusFile,
      JSON.stringify({
        updated_at: Date.now() / 1000,
        bot_id: BOT_ID,
        owner_id: OWNER_ID,
        last_sent_at: lastSent,
        last_error: lastError,
        polling: !stopping,
      }),
    );
    chmodSync(statusFile, 0o600);
  }
  const bot = createBot(cfg.token, status);
  await bot.init();
  if (bot.botInfo.id !== BOT_ID) throw new Error("Unexpected bot identity");
  const webhook = await bot.api.getWebhookInfo();
  if (webhook.url)
    throw new Error(
      "Existing Telegram webhook must be reviewed before polling",
    );

  if (process.argv.includes("--demo")) {
    const result = await bot.api.sendMessage(
      OWNER_ID,
      formatSms(
        {
          id: 0,
          fingerprint: "demo",
          received: Date.now() / 1000,
          sender: tr("Проверка сервиса"),
          recipient: tr("номер Новофона"),
          text: tr(
            "Проверка оформления. Код подтверждения: 123456. Это не настоящий код входа.",
          ),
        },
        true,
      ).text,
      formatSms(
        {
          id: 0,
          fingerprint: "demo",
          received: Date.now() / 1000,
          sender: tr("Проверка сервиса"),
          recipient: tr("номер Новофона"),
          text: tr(
            "Проверка оформления. Код подтверждения: 123456. Это не настоящий код входа.",
          ),
        },
        true,
      ),
    );
    writeFileSync(
      resolve(ROOT, "private/demo-receipt.json"),
      JSON.stringify({
        message_id: result.message_id,
        chat_id: result.chat.id,
        copy_button:
          !!result.reply_markup?.inline_keyboard[0]?.[0] &&
          "copy_text" in result.reply_markup.inline_keyboard[0][0],
      }),
    );
    console.log(
      JSON.stringify({
        message_id: result.message_id,
        chat_id: result.chat.id,
        copy_button:
          !!result.reply_markup?.inline_keyboard[0]?.[0] &&
          "copy_text" in result.reply_markup.inline_keyboard[0][0],
      }),
    );
    inbox.close();
    outbox.close();
  } else {
    let pollingFinished = false;
    const polling = bot
      .start({
        allowed_updates: ["message", "callback_query"],
        onStart: () => {
          receipt();
          console.log("Service bot polling started");
        },
      })
      .catch(() => {
        lastError = "polling_failed";
        stopping = true;
        process.exitCode = 1;
      })
      .finally(() => {
        pollingFinished = true;
      });
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.on(signal, () => {
        stopping = true;
        if (bot.isRunning()) bot.stop();
      });
    while (!stopping && !pollingFinished) {
      try {
        const now = Date.now() / 1000;
        // Delivery state contains no message text or code. Local source expires after one hour.
        outbox
          .prepare("DELETE FROM delivery WHERE received < ?")
          .run(now - 3600);
        const messages = inbox
          .prepare(
            "SELECT id,fingerprint,received,sender,recipient,text FROM sms WHERE received >= ? ORDER BY id",
          )
          .all(now - 3600) as unknown as Sms[];
        for (const sms of messages) {
          if (stopping) break;
          outbox
            .prepare(
              "INSERT OR IGNORE INTO delivery(fingerprint,received) VALUES(?,?)",
            )
            .run(sms.fingerprint, sms.received);
          const delivery = outbox
            .prepare(
              "SELECT sent_at,attempts,next_attempt FROM delivery WHERE fingerprint=?",
            )
            .get(sms.fingerprint)!;
          if (delivery.sent_at !== null || Number(delivery.next_attempt) > now)
            continue;
          try {
            const payload = formatSms(sms);
            const result = await bot.api.sendMessage(OWNER_ID, payload.text, {
              ...payload,
              message_thread_id: smsTopic(),
            });
            outbox
              .prepare(
                "UPDATE delivery SET sent_at=?,message_id=? WHERE fingerprint=?",
              )
              .run(Date.now() / 1000, result.message_id, sms.fingerprint);
            lastSent = Date.now() / 1000;
            lastError = null;
          } catch (e) {
            const attempt = Number(delivery.attempts) + 1;
            const wait =
              e instanceof GrammyError && e.error_code === 429
                ? (e.parameters.retry_after ?? 60)
                : Math.min(300, 5 * 2 ** Math.min(attempt, 6));
            outbox
              .prepare(
                "UPDATE delivery SET attempts=?,next_attempt=? WHERE fingerprint=?",
              )
              .run(attempt, Date.now() / 1000 + wait, sms.fingerprint);
            lastError =
              e instanceof GrammyError
                ? `telegram_${e.error_code}`
                : "network_error";
          }
        }
        receipt();
      } catch {
        lastError = "local_queue_error";
        receipt();
      }
      await sleep(2000);
    }
    if (bot.isRunning()) await bot.stop();
    await polling;
    receipt();
    inbox.close();
    outbox.close();
  }
}
main().catch(() => {
  console.error(
    "Service bot startup failed; credentials and API request omitted",
  );
  process.exitCode = 1;
});
