import test from "node:test";
import assert from "node:assert/strict";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.ts";
test("disabled install has no external effects; CLI/RPC survive reload", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "telegram-projects",
  });
  await plugin(bb);
  const prefs = (await harness.behavior.callRpc("preferences", null)) as any;
  assert.equal(prefs.language, "ru");
  assert.ok(!("token" in prefs));
  const { tokenPresent, tokenSource, tokenEnv, ...editable } = prefs;
  await harness.behavior.callRpc("savePreferences", {
    ...editable,
    language: "en",
  });
  assert.equal(
    ((await harness.behavior.callRpc("preferences", null)) as any).language,
    "en",
  );
  const initial = (await harness.behavior.callRpc("status", null)) as any;
  assert.equal(initial.enabled, false);
  assert.deepEqual(initial.topics, []);
  await harness.behavior.callRpc("sync", null);
  assert.equal(harness.inspection.sdk.calls.length, 0);
  const cli = await harness.behavior.runCli(["status", "--json"]);
  assert.equal(cli.exitCode, 0);
  const next = await harness.lifecycle.reload(plugin);
  await next.harness.behavior.callRpc("status", null);
  await next.harness.lifecycle.dispose();
});
