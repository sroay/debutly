// Design §12. Units are individuals or business crews; breadth evaluators arrive with M4.
export const TIERS = {
  quick: { units: 3, employees: 0 }, // CI / pre-deploy smoke: owners only
  standard: { units: 10, employees: 2 },
  deep: { units: 30, employees: 3 },
} as const;
export type Tier = keyof typeof TIERS;

export interface RunSize {
  tier: Tier;
  units: number;
  employees: number;
}

/** A tier's size, with explicitly given counts taking precedence. */
export function resolveRunSize(o: { tier?: string; units?: number; employees?: number }): RunSize {
  const tier = (o.tier ?? "quick") as Tier;
  if (!(tier in TIERS)) throw new Error(`--tier must be quick, standard or deep (got "${o.tier}")`);
  return { tier, units: o.units ?? TIERS[tier].units, employees: o.employees ?? TIERS[tier].employees };
}

/** Agents a run will use: individuals count once; a crew is its owner plus employees. */
export const agentCount = (kind: "individual" | "business", size: RunSize) =>
  kind === "individual" ? size.units : size.units * (1 + size.employees);

/** Breadth evaluators per tier: Quick ~50, Standard 200–500, Deep 1,000–5,000. */
export const EVALUATORS: Record<Tier, number> = { quick: 50, standard: 300, deep: 1500 };
