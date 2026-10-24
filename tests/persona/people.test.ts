import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { peopleCount, readPeople } from "../../src/persona/people";
import type { CustomerUnit } from "../../src/types";
import { persona } from "../helpers/scripted-agents";

it("reads back an earlier run's people, to run the same agents again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "people-"));
  const units: CustomerUnit[] = [
    { kind: "individual", id: "p1", person: { ...persona("p1", "Ava"), inclusion: "screen_reader", language: "ar" } },
    {
      kind: "business",
      id: "u1",
      business: { name: "Gulf Trade", archetype: "SME", size: 8, monthlyBudget: 300 },
      owner: persona("u1-o", "Khalid"),
      employees: [persona("u1-e1", "Omar"), persona("u1-e2", "Emma")],
    },
  ] as CustomerUnit[];
  await writeFile(join(dir, "people.json"), JSON.stringify(units));
  expect(await readPeople(join(dir, "people.json"))).toEqual(units);
  expect(peopleCount(units)).toBe(4);
});

it("says which file to use when given something else", async () => {
  const dir = await mkdtemp(join(tmpdir(), "people-"));
  await writeFile(join(dir, "sessions.json"), JSON.stringify([{ agentId: "p1", steps: [] }]));
  await expect(readPeople(join(dir, "sessions.json"))).rejects.toThrow("use the people.json from an earlier run's report folder");
  await expect(readPeople(join(dir, "missing.json"))).rejects.toThrow("can't be read");
});
