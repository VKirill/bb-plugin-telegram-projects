import { tr } from "./locale.js";
export interface Sms {
  id: number;
  fingerprint: string;
  received: number;
  sender: string;
  recipient: string;
  text: string;
}
export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function extractCodes(text: string): string[] {
  const blocked = [
    ...text.matchAll(/\+?\d(?:[ ()-]*\d){9,14}|\b\d{2}[./]\d{2}[./]\d{2,4}\b/g),
  ].map((m) => [m.index!, m.index! + m[0].length]);
  const result: string[] = [];
  for (const m of text.matchAll(
    /(?<![\p{L}\p{N}])(?:\d{3}[ -]\d{3}|\d{4,8})(?![\p{L}\p{N}])/gu,
  )) {
    const i = m.index!;
    if (blocked.some(([a, b]) => i >= a && i < b)) continue;
    if (
      /^\s*(?:₽|руб|р\.|€|EUR|USD|доллар|минут|мин\b|сек)/i.test(
        text.slice(i + m[0].length),
      )
    )
      continue;
    const nearby = text.slice(Math.max(0, i - 65), i + m[0].length + 45);
    if (
      !/(?:код|code|otp|парол|подтверж|verification|одноразов)/i.test(nearby) &&
      text.trim() !== m[0]
    )
      continue;
    const code = m[0].replace(/[ -]/g, "");
    if (!result.includes(code)) result.push(code);
  }
  return result.slice(0, 3);
}

export function formatSms(sms: Sms, demo = false) {
  const codes = extractCodes(sms.text);
  const when = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Madrid",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(sms.received * 1000);
  const heading = demo
    ? tr("📱 SMS на телефон · проверка оформления")
    : tr("📱 SMS на телефон");
  const parts = [
    `<b>${heading}</b>`,
    tr("От: <b>") + String(escapeHtml(sms.sender || tr("не указан"))) + "</b>",
    tr("На номер: <code>") +
      String(escapeHtml(sms.recipient || tr("не указан"))) +
      "</code>",
    tr("Получено на Mini: ") + String(when) + tr(" · Мадрид"),
  ];
  if (codes.length)
    parts.push(
      "",
      codes
        .map(
          (c, i) =>
            `${codes.length > 1 ? tr("Код ") + (i + 1) : tr("Код")}: <code>${c}</code>`,
        )
        .join("\n"),
    );
  if (demo)
    parts.push("", tr("<i>Это демонстрация, не настоящий код входа.</i>"));
  // Telegram has a 4096-character message limit. Keep complete SMS text in local inbox.
  parts.push(
    "",
    escapeHtml(
      sms.text.length > 2800
        ? sms.text.slice(0, 2800) + tr("\n… Полный текст сохранён на Mini.")
        : sms.text,
    ),
  );
  return {
    text: parts.join("\n"),
    parse_mode: "HTML" as const,
    link_preview_options: { is_disabled: true },
    reply_markup: codes.length
      ? {
          inline_keyboard: codes.map((code, i) => [
            {
              text:
                codes.length > 1
                  ? tr("📋 Скопировать код ") + String(i + 1) + ""
                  : tr("📋 Скопировать код"),
              copy_text: { text: code },
            },
          ]),
        }
      : undefined,
  };
}
