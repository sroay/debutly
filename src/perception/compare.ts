import { z } from "zod";
import type { LlmClient, LlmMessage, LlmUsage } from "../llm/types";
import type { Persona } from "../types";
import { extractJsonObject } from "../util/json";
import { ATTEMPTS, ObjectionSchema, personaBrief, REPLY_TOKENS, RUBRIC } from "./evaluate";
import { canonicalExhibitId, renderExhibits, type Exhibit } from "./exhibits";

const PairSchema = z.object({
  objections1: z.array(ObjectionSchema).min(1),
  objections2: z.array(ObjectionSchema).min(1),
  preferred: z.enum(["1", "2", "neither"]),
  reasons: z.array(z.string()).min(1),
});

export interface PairJudgment {
  evaluatorId: string;
  preferred: "A" | "B" | "neither";
  reasons: string[];
  objectionsA: z.infer<typeof ObjectionSchema>[];
  objectionsB: z.infer<typeof ObjectionSchema>[];
  /** Which variant was shown first, for checking position bias later. */
  shownFirst: "A" | "B";
}

const SHAPE = `Reply with one JSON object: {"objections1":[{"category","text","exhibitId"}],"objections2":[...],"preferred":"1"|"2"|"neither","reasons":[string]}. Name at least one objection to each option before choosing. "neither" is a valid answer.`;

/**
 * Design §3 experiment mode: one buyer sees two variants and picks one (or neither). Variants
 * appear as Option 1/2 in random order so position bias averages out across evaluators.
 */
export async function comparePair(
  llm: LlmClient,
  persona: Persona,
  a: Exhibit[],
  b: Exhibit[],
  o: { market?: string; onUsage?: (u: LlmUsage) => void },
  rng: () => number = Math.random,
): Promise<PairJudgment | null> {
  const aFirst = rng() < 0.5;
  const [first, second] = aFirst ? [a, b] : [b, a];
  // Blind: no variant names, file names or web addresses, which would give away which is which.
  const blind = (pages: Exhibit[], option: number) => pages.map((e, i) => ({ ...e, id: `${option}.${i + 1}`, url: undefined }));
  const shown1 = blind(first, 1);
  const shown2 = blind(second, 2);
  const messages: LlmMessage[] = [
    {
      role: "user",
      content: `${o.market ? `${o.market}\n\n` : ""}Two versions of the same product. Which would you rather buy?\n\n## Option 1\n\n${renderExhibits(shown1)}\n\n## Option 2\n\n${renderExhibits(shown2)}\n\n${SHAPE}`,
    },
  ];
  // Maps an objection's page reference ("1.2", "pricing"...) back to the real exhibit id.
  const realId = (ref: string | undefined, shown: Exhibit[], real: Exhibit[]) => {
    const id = canonicalExhibitId(ref, shown);
    return id ? real[shown.findIndex((e) => e.id === id)]?.id : undefined;
  };
  const system = `${personaBrief(persona)}\n\n${RUBRIC}`;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const raw = await llm.complete({ system, messages: [...messages], maxTokens: REPLY_TOKENS, onUsage: o.onUsage });
    try {
      const p = PairSchema.parse(extractJsonObject(raw));
      const toVariant = (opt: "1" | "2") => ((opt === "1") === aFirst ? "A" : "B");
      p.objections1 = p.objections1.map((o) => ({ ...o, exhibitId: realId(o.exhibitId, shown1, first) }));
      p.objections2 = p.objections2.map((o) => ({ ...o, exhibitId: realId(o.exhibitId, shown2, second) }));
      return {
        evaluatorId: persona.id,
        preferred: p.preferred === "neither" ? "neither" : toVariant(p.preferred),
        reasons: p.reasons,
        objectionsA: aFirst ? p.objections1 : p.objections2,
        objectionsB: aFirst ? p.objections2 : p.objections1,
        shownFirst: aFirst ? "A" : "B",
      };
    } catch (err) {
      messages.push({ role: "assistant", content: raw || "(empty)" }, { role: "user", content: `That reply was not valid (${String(err).slice(0, 200)}). ${SHAPE}` });
    }
  }
  return null;
}
