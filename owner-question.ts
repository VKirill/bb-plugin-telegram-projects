import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

type Interaction = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["interactions"]["get"]>>;
const formSchema = z.object({ questions: z.array(z.object({
  id: z.string().min(1), prompt: z.string().min(1),
  multiSelect: z.literal(false), allowFreeText: z.boolean(),
  options: z.array(z.object({
    value: z.string().min(1), label: z.string().min(1).max(48),
    description: z.string().optional(), preview: z.string().optional(),
  })).min(2).max(4),
})).length(1) });

/** Only BB's official AskUserQuestion form; arbitrary plugin forms remain BB-only. */
export function ownerQuestion(i: Interaction) {
  if (i.payload.kind === "user_question")
    return { questions: i.payload.questions, plugin: false, prompt: i.payload.questions.map(q => q.prompt).join("\n\n") };
  if (i.payload.kind !== "plugin" || i.origin?.kind !== "plugin" ||
      i.origin.pluginId !== "ask-user-question" || i.origin.rendererId !== "ask-user-question") return null;
  const parsed = formSchema.safeParse(i.payload.data);
  if (!parsed.success) return null;
  const q = parsed.data.questions[0];
  if (new Set(q.options.map(o => o.value)).size !== q.options.length ||
      new Set(q.options.map(o => o.label)).size !== q.options.length ||
      q.options.some(o => o.preview !== undefined)) return null;
  const prompt = q.prompt + q.options.map(o => o.description ? `\n${o.label}: ${o.description}` : "").join("");
  // Never attach approval buttons to a truncated post, description or visual preview.
  if (prompt.length > 2400) return null;
  return { questions: parsed.data.questions, plugin: true, prompt };
}
