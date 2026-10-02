import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BOT_COMMANDS, menuCommands } from "../commands";
test("menu lists every argument-free command with a Telegram-valid description", () => {
  const menu = menuCommands("ru");
  assert.deepEqual(
    menu.map((c) => c.command),
    BOT_COMMANDS.filter((c) => !c.args).map((c) => c.command),
  );
  for (const c of [...menu, ...menuCommands("en")]) {
    assert.match(c.command, /^[a-z0-9_]{1,32}$/);
    assert.ok(c.description.length >= 1 && c.description.length <= 256);
  }
});
test("every documented command is handled by the bot", () => {
  const chat = readFileSync(new URL("../chat.ts", import.meta.url), "utf8");
  const ingress = readFileSync(new URL("../ingress.ts", import.meta.url), "utf8");
  for (const { command } of BOT_COMMANDS)
    assert.ok(
      chat.includes(`"/${command}"`) || ingress.includes(`\\/${command}`),
      command,
    );
});
