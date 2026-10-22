import { z } from "zod";
import type { LlmClient } from "../llm/types";
import { extractJsonObject } from "../util/json";
import { renderExhibits, type Exhibit } from "./exhibits";

const MarketContextSchema = z.object({
  competitors: z
    .array(z.object({ name: z.string().min(1), url: z.string().optional(), pricing: z.string(), positioning: z.string() }))
    .min(1),
  complaints: z.array(z.string()),
  switchingTriggers: z.array(z.string()),
});

/** What buyers in this market compare against, built before personas and verdicts. */
export type MarketContext = z.infer<typeof MarketContextSchema> & { sources: string[] };

const SYSTEM = `You build a Market Context bundle for a product simulation from competitors' own pages.
For each competitor, "pricing" and "positioning" must come from the pages you are given (quote or closely summarise; write "not shown" if absent). Never invent prices.
"complaints" are common frustrations buyers in this category have; "switchingTriggers" are what makes them switch tools. You may use general knowledge for these two, but prefix each such item with "(general knowledge)".
Reply with one JSON object: {"competitors":[{"name","url","pricing","positioning"}],"complaints":[string],"switchingTriggers":[string]}.`;

export async function buildMarketContext(
  llm: LlmClient,
  o: { icp: string; product: string; competitorExhibits: Exhibit[] },
): Promise<MarketContext> {
  const raw = await llm.complete({
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Product being tested: ${o.product}\nIts buyers: ${o.icp}\n\nCompetitor pages:\n\n${renderExhibits(o.competitorExhibits)}`,
      },
    ],
    maxTokens: 4000,
  });
  const parsed = MarketContextSchema.parse(extractJsonObject(raw));
  return { ...parsed, sources: [...new Set(o.competitorExhibits.map((e) => e.url).filter((u): u is string => !!u))] };
}

/** A compact brief for persona and evaluator prompts. */
export function marketBrief(ctx: MarketContext): string {
  return [
    "Alternatives these buyers know:",
    ...ctx.competitors.map((c) => `- ${c.name}: ${c.pricing} (${c.positioning})`),
    ctx.complaints.length ? `Common frustrations in this category: ${ctx.complaints.join("; ")}` : "",
    ctx.switchingTriggers.length ? `What makes buyers switch: ${ctx.switchingTriggers.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
