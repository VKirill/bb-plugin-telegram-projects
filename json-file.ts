import { writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export async function writeJsonAtomic(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export function makeChatControlPublisher(path: string) {
  let previous: string | undefined;
  let pending = Promise.resolve();
  return (enabled: boolean, language: string): Promise<void> => {
    const next = pending.catch(() => {}).then(async () => {
      const key = JSON.stringify([enabled, language]);
      if (key === previous) return;
      await writeJsonAtomic(path, { enabled, language, updatedAt: Date.now() });
      previous = key;
    });
    pending = next;
    return next;
  };
}
