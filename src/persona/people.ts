import { readFile } from "node:fs/promises";
import type { CustomerUnit } from "../types";

/** Each run writes its people here, next to the report, so a later run can meet the same ones. */
export const PEOPLE_FILE = "people.json";

/**
 * The people of an earlier run, to run the same agents again: after a fix, whether it worked is
 * only clear with the same people, needs and languages. Generated afresh, a run had a different
 * crew every day (needs rotate daily), and two runs of one app could not be compared.
 */
export async function readPeople(path: string): Promise<CustomerUnit[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    throw new Error(`${path} can't be read: ${err instanceof Error ? err.message : err}`);
  }
  const ok = (u: unknown) => {
    const unit = u as Partial<CustomerUnit> | null;
    if (!unit || typeof unit !== "object" || typeof unit.id !== "string") return false;
    if (unit.kind === "individual") return !!unit.person?.id;
    return unit.kind === "business" && !!unit.owner?.id && Array.isArray(unit.employees);
  };
  if (!Array.isArray(parsed) || !parsed.length || !parsed.every(ok)) {
    throw new Error(`${path} doesn't hold a run's people: use the ${PEOPLE_FILE} from an earlier run's report folder.`);
  }
  return parsed as CustomerUnit[];
}

/** How many agents the units make: everyone in a crew is one. */
export const peopleCount = (units: CustomerUnit[]) => units.reduce((n, u) => n + (u.kind === "individual" ? 1 : 1 + u.employees.length), 0);
