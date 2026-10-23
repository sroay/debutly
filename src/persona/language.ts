import type { CustomerUnit, Persona } from "../types";

// Customers' first languages (--languages ar,en): agents take them in turn, and one whose first
// language isn't English uses the site in it when it can. Arabic speakers also type as an Arabic
// phone keyboard does, which is where Gulf sign-up forms often break.

const NAMES: Record<string, string> = {
  ar: "Arabic",
  en: "English",
  fr: "French",
  de: "German",
  es: "Spanish",
  hi: "Hindi",
  ur: "Urdu",
  fa: "Persian",
  tr: "Turkish",
  ru: "Russian",
  zh: "Chinese",
};

export const languageName = (code: string) => NAMES[code] ?? code;

/** "ar, en" → ["ar", "en"]. Language codes as in a page's lang attribute. */
export function parseLanguages(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const codes = value.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
  const bad = codes.find((c) => !/^[a-z]{2,3}$/.test(c));
  if (bad) throw new Error(`--languages takes language codes such as ar,en (got "${bad}")`);
  return [...new Set(codes)];
}

/** What the persona generator is told, so each person gets a first language and a name to match. */
export function languageRequest(languages: string[]): string {
  if (!languages.length) return "";
  const list = languages.map((c) => `"${c}" (${languageName(c)})`).join(", ");
  return `Give each person a "language": their first language, one of ${list}, mixing them across the people, and a name that fits it.`;
}

/** Each person gets one of the languages: the one the generator gave, if it's on the list, or the next in turn. */
export function withLanguages(units: CustomerUnit[], languages: string[]): CustomerUnit[] {
  if (!languages.length) return units;
  let next = 0;
  const assign = (p: Persona): Persona => {
    const chosen = p.language && languages.includes(p.language) ? p.language : languages[next % languages.length];
    next++;
    return { ...p, language: chosen };
  };
  return units.map((u) =>
    u.kind === "individual" ? { ...u, person: assign(u.person) } : { ...u, owner: assign(u.owner), employees: u.employees.map(assign) },
  );
}

/** The agent's instructions for its first language; nothing for English. */
export function languageBrief(code: string | undefined): string {
  if (!code || code === "en") return "";
  if (code === "ar")
    return "Your first language is Arabic. If the site offers Arabic, switch to it. Write your name in Arabic script, and type numbers such as phone numbers the way your phone's Arabic keyboard does, with Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩), unless the field shows another format.";
  return `Your first language is ${languageName(code)}. If the site offers ${languageName(code)}, switch to it.`;
}
