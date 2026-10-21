import { expect, it } from "vitest";
import { generatePersonas, generateUnits } from "../../src/persona/generate";
import { ScriptedLlm } from "../../src/llm/scripted";

const p = (name: string) => ({ name, background: "Runs an agency.", goal: "Automate content.", patience: "low", techSavvy: "high" });

it("parses personas, assigns ids and caps the count", async () => {
  const llm = new ScriptedLlm(() => `Here you go:\n${JSON.stringify([p("Ava"), p("Ben"), p("Cara")])}`);
  const personas = await generatePersonas(llm, "Small marketing agencies", 2);
  expect(personas.map((x) => [x.id, x.name])).toEqual([
    ["p1", "Ava"],
    ["p2", "Ben"],
  ]);
  expect(llm.calls[0].messages[0].content).toContain("Small marketing agencies");
});

it("rejects malformed personas", async () => {
  const llm = new ScriptedLlm(() => JSON.stringify([{ name: "Ava" }]));
  await expect(generatePersonas(llm, "icp", 1)).rejects.toThrow();
});

const person = (name: string, extra = {}) => ({ name, background: "b", goal: "g", patience: "medium", techSavvy: "high", ...extra });

it("builds business crews with an owner and role-differentiated employees, capped", async () => {
  const llm = new ScriptedLlm(() =>
    JSON.stringify([
      {
        business: { name: "Acme Studio", archetype: "agency", size: 12, monthlyBudget: 300, goal: "win clients" },
        owner: person("Olga"),
        employees: [person("Emil", { role: "Designer" }), person("Ema", { role: "Developer" }), person("Eli", { role: "Writer" })],
      },
    ]),
  );
  const [unit] = await generateUnits(llm, "agencies", { kind: "business", count: 1, employees: 2 });
  expect(unit.kind).toBe("business");
  if (unit.kind !== "business") return;
  expect(unit.id).toBe("u1");
  expect(unit.business).toMatchObject({ name: "Acme Studio", monthlyBudget: 300 });
  expect(unit.owner).toMatchObject({ id: "u1-o", name: "Olga", role: "Owner" });
  expect(unit.employees.map((e) => [e.id, e.role])).toEqual([
    ["u1-e1", "Designer"],
    ["u1-e2", "Developer"],
  ]);
  expect(llm.calls[0].messages[0].content).toContain("2 employees");
});

it("builds individuals with life context and keeps p1… ids", async () => {
  const llm = new ScriptedLlm(() => JSON.stringify([person("Priya")]));
  const units = await generateUnits(llm, "job seekers", { kind: "individual", count: 1, employees: 0 });
  expect(units).toEqual([{ kind: "individual", id: "p1", person: expect.objectContaining({ id: "p1", name: "Priya" }) }]);
  expect(llm.calls[0].system).toMatch(/life and career stage/);
});

it("asks for owner-only businesses when there are no employees", async () => {
  const llm = new ScriptedLlm(() =>
    JSON.stringify([{ business: { name: "Solo Co", archetype: "freelancer", size: 1, monthlyBudget: 50, goal: "g" }, owner: person("Sam"), employees: [] }]),
  );
  const [unit] = await generateUnits(llm, "freelancers", { kind: "business", count: 1, employees: 0 });
  expect(unit.kind === "business" && unit.employees).toEqual([]);
});
