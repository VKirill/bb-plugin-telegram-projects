import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { english } from "../locale";
// With English selected every bot text must switch: a Russian literal passed to tr()
// or translate() without an English entry would reach the user untranslated.
test("every Russian bot text has an English translation", () => {
  const missing: string[] = [];
  for (const f of ["chat.ts", "server.ts", "model.ts"]) {
    const src = readFileSync(new URL("../" + f, import.meta.url), "utf8");
    const re =
      /(?:\btr|this\.tr|translate\([^,()]+,)\s*\(?\s*\n?\s*("(?:[^"\\]|\\.)*")/g;
    for (const m of src.matchAll(re)) {
      const s = JSON.parse(m[1]);
      if (/[А-Яа-яЁё]/.test(s) && !(s in english)) missing.push(`${f}: ${s}`);
    }
  }
  assert.deepEqual(missing, []);
});
