import { useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
function Panel() {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh(sync = false) {
    setBusy(true);
    try {
      setData(await rpc.call(sync ? "sync" : "status", null));
      setError("");
    } catch {
      setError("Не удалось получить состояние");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <main className="max-w-4xl mx-auto p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Telegram · проекты</h1>
      <p className="text-muted-foreground">
        Темы проектов, уведомления Tasks и общение с BB. Ответы приходят только
        из явно подключённых чатов.
      </p>
      <button
        className="border rounded-md px-4 py-2"
        disabled={busy}
        onClick={() => void refresh(true)}
      >
        {busy ? "Проверяю…" : "Синхронизировать"}
      </button>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p>
            {data.enabled
              ? "Синхронизация включена"
              : "Синхронизация выключена"}{" "}
            · @{data.bot}
          </p>
          {data.error && (
            <p role="alert">
              {data.error === "threaded_mode_disabled"
                ? "Включите Threaded Mode в BotFather для @aivech_bot. Плагин проверяет настройку автоматически."
                : `Проблема доставки: ${data.error}`}
            </p>
          )}
          <p>
            В очереди: {data.queue} · Задач отслеживается: {data.tasks}
          </p>
          <p>
            Общение с BB: {data.chatEnabled ? "включено" : "выключено"} ·
            Подключено чатов:{" "}
            {data.chatBindings.filter((b: any) => b.threadId).length} · Очередь
            ответов: {data.chatQueue}
          </p>
          <p className="text-sm text-muted-foreground">
            В Telegram: /project — привязать тему, /chats — выбрать чат, /new —
            новый чат, /model — агент и модель.
          </p>
          {data.chatError && (
            <p role="alert">Последняя ошибка общения: {data.chatError}</p>
          )}
          <table className="w-full text-left">
            <thead>
              <tr>
                <th className="py-3">Тема</th>
                <th>Состояние</th>
              </tr>
            </thead>
            <tbody>
              {data.topics.map((t: any) => (
                <tr className="border-t" key={t.key}>
                  <td className="py-3">{t.name}</td>
                  <td>
                    {t.creating
                      ? "Нужно проверить создание"
                      : t.threadId
                        ? "Подключена"
                        : "Ожидает создания"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-sm text-muted-foreground">
            При удалении проекта его тема и история в Telegram удаляются.
            Настройки доставки доступны в настройках плагина Telegram Projects.
          </p>
        </>
      )}
    </main>
  );
}
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "telegram-projects",
    title: "Telegram",
    icon: "MessageCircle",
    path: "telegram-projects",
    component: Panel,
  });
});
