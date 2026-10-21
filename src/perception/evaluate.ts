import { z } from "zod";
import type { LlmClient, LlmMessage, LlmUsage } from "../llm/types";
import type { Persona } from "../types";
import { extractJsonObject } from "../util/json";
import { canonicalExhibitId, renderExhibits, type Exhibit } from "./exhibits";

export const OBJECTION_CATEGORIES = [
  "price",
  "unclear_value",
  "trust",
  "missing_feature",
  "complexity",
  "switching_cost",
  "integration",
  "timing",
  "other",
] as const;
export type ObjectionCategory = (typeof OBJECTION_CATEGORIES)[number];

// Reasoning models spend part of the reply budget thinking and can return nothing if it is
// tight; allow room, and ask again on an empty or invalid reply.
export const REPLY_TOKENS = 4000;
export const ATTEMPTS = 3;

const score = z.number().int().min(1).max(5);
export const ObjectionSchema = z.object({ category: z.enum(OBJECTION_CATEGORIES), text: z.string().min(3), exhibitId: z.string().optional() });

const VerdictSchema = z.object({
  objections: z.array(ObjectionSchema).min(2, "list at least 2 objections"),
  confusions: z.array(z.object({ text: z.string(), exhibitId: z.string().optional() })),
  scores: z.object({ clarity: score, credibility: score, value: score, urgency: score }),
  intent: z.enum(["no", "maybe", "yes"]),
  wouldPay: z.object({ plan: z.string(), monthlyUsd: z.number().nonnegative() }).nullable(),
  summary: z.string(),
});

export type Verdict = z.infer<typeof VerdictSchema> & { evaluatorId: string };

// Design §7: adversarial by design, to counter LLM agreeableness.
export const RUBRIC = `You are a skeptical buyer with a limited budget, judging a product only from the pages you are shown.
Rules:
- First list at least 2 specific objections, each tied to an exhibit id, with a category: ${OBJECTION_CATEGORIES.join(", ")}.
- Default to "no". Say "maybe" or "yes" only if the pages give you a concrete reason, and compare against the alternatives you know.
- Score strictly from 1 (poor) to 5 (excellent): clarity, credibility, value, urgency. A 5 must be earned.
- Never assume features, prices or guarantees the pages do not show.
- "wouldPay" is the plan and monthly USD you would actually pay, or null.`;

const SHAPE = `Reply with one JSON object: {"objections":[{"category","text","exhibitId"}],"confusions":[{"text","exhibitId"}],"scores":{"clarity","credibility","value","urgency"},"intent":"no"|"maybe"|"yes","wouldPay":{"plan","monthlyUsd"}|null,"summary":string}.`;

export const personaBrief = (p: Persona) => `You are ${p.name}. ${p.background} What you want: ${p.goal}. Patience: ${p.patience}.`;

/** One evaluator's verdict on the exhibits; null if it never produced a valid one (counted as unusable). */
export async function evaluate(
  llm: LlmClient,
  persona: Persona,
  exhibits: Exhibit[],
  o: { market?: string; onUsage?: (u: LlmUsage) => void },
): Promise<Verdict | null> {
  const messages: LlmMessage[] = [
    { role: "user", content: `${o.market ? `${o.market}\n\n` : ""}The product's pages:\n\n${renderExhibits(exhibits)}\n\n${SHAPE}` },
  ];
  const system = `${personaBrief(persona)}\n\n${RUBRIC}`;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const raw = await llm.complete({ system, messages: [...messages], maxTokens: REPLY_TOKENS, onUsage: o.onUsage });
    try {
      const v = VerdictSchema.parse(extractJsonObject(raw));
      const page = (ref?: string) => canonicalExhibitId(ref, exhibits);
      return {
        evaluatorId: persona.id,
        ...v,
        objections: v.objections.map((o) => ({ ...o, exhibitId: page(o.exhibitId) })),
        confusions: v.confusions.map((c) => ({ ...c, exhibitId: page(c.exhibitId) })),
      };
    } catch (err) {
      const problem = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : String(err);
      messages.push(
        { role: "assistant", content: raw || "(empty)" },
        { role: "user", content: `That reply was not valid (${problem.slice(0, 300)}). Follow the rules, including at least 2 objections. ${SHAPE}` },
      );
    }
  }
  return null;
}
