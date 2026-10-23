import { z } from "zod";
import type { LlmClient } from "../llm/types";
import type { CustomerUnit, Persona } from "../types";

const PersonaSchema = z.object({
  // A period would break "You are <name>." in the agent prompt.
  name: z
    .string()
    .min(1)
    .refine((n) => !n.includes("."), "name must not contain a period"),
  background: z.string(),
  goal: z.string(),
  patience: z.enum(["low", "medium", "high"]),
  techSavvy: z.enum(["low", "medium", "high"]),
});

const BusinessUnitSchema = z.object({
  business: z.object({
    name: z.string().min(1),
    archetype: z.string().min(1),
    size: z.number().int().positive(),
    monthlyBudget: z.number().nonnegative(),
    goal: z.string(),
  }),
  owner: PersonaSchema,
  employees: z.array(PersonaSchema.extend({ role: z.string().min(1) })),
});

// Personas describe customers, not their beliefs: no politics or religion.
const NEUTRAL = "Leave out politics and religion.";
const SYSTEM = `You design realistic, diverse customer personas for product simulation. Vary role, company size, budget, urgency, patience and technical skill. Include skeptical and hard-to-please people, not just enthusiasts. ${NEUTRAL} Output only a JSON array.`;
const INDIVIDUAL_SYSTEM = `You design realistic, diverse individual consumers for product simulation. Vary life and career stage, urgency, price sensitivity, region and technical skill. Include skeptical and hard-to-please people, not just enthusiasts. ${NEUTRAL} Output only a JSON array.`;
const BUSINESS_SYSTEM = `You design realistic, diverse businesses for product simulation. Vary archetype (agency, SME, small business, freelancer, startup, enterprise team), industry, size, budget and urgency. Give employees distinct everyday roles. Include skeptical and hard-to-please people, not just enthusiasts. ${NEUTRAL} Output only a JSON array.`;
const PERSONA_SHAPE = `{"name": first name only, "background": 1-2 sentences, "goal": what they want from this product, "patience": "low"|"medium"|"high", "techSavvy": "low"|"medium"|"high"}`;

function extractJsonArray(raw: string): unknown {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error("no JSON array in persona reply");
  return JSON.parse(raw.slice(start, end + 1));
}

async function ask(llm: LlmClient, system: string, content: string): Promise<unknown> {
  return extractJsonArray(await llm.complete({ system, messages: [{ role: "user", content }], maxTokens: 16000 }));
}

export async function generatePersonas(llm: LlmClient, icp: string, count: number, system = SYSTEM): Promise<Persona[]> {
  const raw = await ask(llm, system, `Ideal customer profile:\n${icp}\n\nReturn a JSON array of ${count} distinct personas. Each item: ${PERSONA_SHAPE}.`);
  const parsed = z.array(PersonaSchema).parse(raw);
  return parsed.slice(0, count).map((persona, i) => ({ id: `p${i + 1}`, ...persona }));
}

export interface UnitOptions {
  kind: CustomerUnit["kind"];
  count: number;
  /** Employees per business crew (0 = owner only). */
  employees: number;
}

/** Customer units from an ICP: individuals (B2C) or business crews of owner + employees (B2B). */
export async function generateUnits(llm: LlmClient, icp: string, o: UnitOptions): Promise<CustomerUnit[]> {
  if (o.kind === "individual") {
    const people = await generatePersonas(llm, icp, o.count, INDIVIDUAL_SYSTEM);
    return people.map((person) => ({ kind: "individual", id: person.id, person }));
  }
  const raw = await ask(
    llm,
    BUSINESS_SYSTEM,
    `Ideal customer profile:\n${icp}\n\nReturn a JSON array of ${o.count} distinct businesses. Each item: {"business": {"name": string, "archetype": string, "size": number of people, "monthlyBudget": number in USD they would spend on a tool like this, "goal": string}, "owner": the decision-maker, ${PERSONA_SHAPE}, "employees": ${o.employees} employees, each ${PERSONA_SHAPE.slice(0, -1)}, "role": their job title}}.`,
  );
  const parsed = z.array(BusinessUnitSchema).parse(raw);
  return parsed.slice(0, o.count).map((u, i) => {
    const id = `u${i + 1}`;
    return {
      kind: "business",
      id,
      business: u.business,
      owner: { id: `${id}-o`, ...u.owner, role: "Owner" },
      employees: u.employees.slice(0, o.employees).map((e, j) => ({ id: `${id}-e${j + 1}`, ...e })),
    };
  });
}
