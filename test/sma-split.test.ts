import test from "node:test";
import assert from "node:assert/strict";
import { splitText } from "../chat";

test("[sma:m_tg_split] a long answer goes out as the same words in as few messages as the limit allows, cut at line ends", () => {
  const lines = Array.from({ length: 70 }, (_, i) => `${String(i).padStart(2, "0")} ${"word ".repeat(19)}`.trimEnd());
  const text = lines.join("\n");
  const chunks = splitText(text);
  assert.equal(chunks.length, Math.ceil(text.length / 3500));
  assert.ok(chunks.every((chunk) => chunk.length <= 3500));
  assert.equal(chunks.join("\n"), text);
  assert.ok(chunks.every((chunk) => lines.includes(chunk.split("\n").at(-1)!)));
  const unbroken = "x".repeat(5000);
  assert.deepEqual(splitText(unbroken).map((chunk) => chunk.length), [3500, 1500]);
});
