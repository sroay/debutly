import { expect, it } from "vitest";
import { languageBrief, languageRequest, parseLanguages, withLanguages } from "../../src/persona/language";
import type { CustomerUnit, Persona } from "../../src/types";

const p = (id: string, language?: string): Persona => ({ id, name: id, background: "", goal: "", patience: "medium", techSavvy: "medium", ...(language ? { language } : {}) });

it("reads a list of language codes", () => {
  expect(parseLanguages(" AR, en ,ar")).toEqual(["ar", "en"]);
  expect(parseLanguages(undefined)).toEqual([]);
  expect(() => parseLanguages("arabic")).toThrow(/language codes such as ar,en \(got "arabic"\)/);
});

it("gives every person, owners and teammates alike, one of the languages", () => {
  const units: CustomerUnit[] = [
    { kind: "individual", id: "p1", person: p("p1", "ar") },
    { kind: "business", id: "u1", business: { name: "B", archetype: "agency", size: 3, monthlyBudget: 50, goal: "g" }, owner: p("u1-o", "fr"), employees: [p("u1-e1")] },
  ];
  const out = withLanguages(units, ["ar", "en"]);
  const langs = out.flatMap((u) => (u.kind === "individual" ? [u.person.language] : [u.owner.language, ...u.employees.map((e) => e.language)]));
  // Kept where the generator chose one on the list; otherwise the next in turn.
  expect(langs).toEqual(["ar", "en", "ar"]);
  expect(withLanguages(units, [])).toBe(units);
});

it("asks the generator for first languages and names to match", () => {
  expect(languageRequest(["ar", "en"])).toBe('Give each person a "language": their first language, one of "ar" (Arabic), "en" (English), mixing them across the people, and a name that fits it.');
  expect(languageRequest([])).toBe("");
});

it("tells an Arabic speaker to use the site in Arabic and type as an Arabic keyboard does", () => {
  expect(languageBrief("ar")).toContain("switch to it");
  expect(languageBrief("ar")).toContain("٠١٢٣٤٥٦٧٨٩");
  expect(languageBrief("fr")).toBe("Your first language is French. If the site offers French, switch to it.");
  expect(languageBrief("en")).toBe("");
  expect(languageBrief(undefined)).toBe("");
});
