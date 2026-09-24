import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeChatControlPublisher, writeJsonAtomic } from "../json-file.ts";

test("control is published only on state changes, including disable and language", async () => {
  const dir = await mkdtemp(join(tmpdir(), "telegram-control-"));
  try {
    const file = join(dir, "control.json");
    const publish = makeChatControlPublisher(file);
    await publish(true, "ru");
    const before = await stat(file);
    const contents = await readFile(file, "utf8");
    await Promise.all(Array.from({ length: 20 }, () => publish(true, "ru")));
    assert.equal((await stat(file)).ino, before.ino);
    assert.equal(await readFile(file, "utf8"), contents);
    assert.equal(before.mode & 0o777, 0o600);
    await Promise.all([publish(true, "en"), publish(false, "en")]);
    assert.deepEqual(Object.keys(JSON.parse(await readFile(file, "utf8"))).sort(), ["enabled", "language", "updatedAt"]);
    const result = JSON.parse(await readFile(file, "utf8"));
    assert.equal(result.enabled, false);
    assert.equal(result.language, "en");
    assert.deepEqual(await readdir(dir), ["control.json"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("failed control publication is retried for the same settings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "telegram-control-"));
  try {
    const file = join(dir, "missing", "control.json");
    const publish = makeChatControlPublisher(file);
    await assert.rejects(publish(true, "ru"));
    await mkdir(join(dir, "missing"));
    await publish(true, "ru");
    assert.equal(JSON.parse(await readFile(file, "utf8")).enabled, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a failed atomic replacement preserves the destination and removes temporary files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "telegram-control-"));
  try {
    const target = join(dir, "occupied");
    await mkdir(target);
    await writeFile(join(target, "keep"), "original");
    await assert.rejects(writeJsonAtomic(target, { enabled: true }));
    assert.equal(await readFile(join(target, "keep"), "utf8"), "original");
    assert.deepEqual(await readdir(dir), ["occupied"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
