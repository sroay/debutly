// WCAG 2.2 success criteria a finding relates to. They point a person at what to check; Debutly
// doesn't test conformance, and a run without them says nothing about it.

export interface Criterion {
  id: string;
  name: string;
  level: "A" | "AA";
  /** The criterion's page in W3C's "Understanding WCAG 2.2". */
  url: string;
}

const understanding = (slug: string) => `https://www.w3.org/WAI/WCAG22/Understanding/${slug}`;

export const CRITERIA: Record<string, Criterion> = {
  "1.3.1": { id: "1.3.1", name: "Info and Relationships", level: "A", url: understanding("info-and-relationships") },
  "1.4.4": { id: "1.4.4", name: "Resize Text", level: "AA", url: understanding("resize-text") },
  "1.4.10": { id: "1.4.10", name: "Reflow", level: "AA", url: understanding("reflow") },
  "2.1.1": { id: "2.1.1", name: "Keyboard", level: "A", url: understanding("keyboard") },
  "2.4.4": { id: "2.4.4", name: "Link Purpose (In Context)", level: "A", url: understanding("link-purpose-in-context") },
  "2.4.11": { id: "2.4.11", name: "Focus Not Obscured (Minimum)", level: "AA", url: understanding("focus-not-obscured-minimum") },
  "3.1.1": { id: "3.1.1", name: "Language of Page", level: "A", url: understanding("language-of-page") },
  "3.3.2": { id: "3.3.2", name: "Labels or Instructions", level: "A", url: understanding("labels-or-instructions") },
  "4.1.2": { id: "4.1.2", name: "Name, Role, Value", level: "A", url: understanding("name-role-value") },
};

/** The criteria an unnamed control relates to, by what kind of control it is. */
export function unlabeledCriteria(control: string): string[] {
  if (control === "link") return ["2.4.4", "4.1.2"];
  if (control === "button") return ["4.1.2"];
  // Fields: a dropdown, text box, checkbox, radio button…
  return ["1.3.1", "3.3.2", "4.1.2"];
}

/** "4.1.2 Name, Role, Value (A)", linked for Markdown. */
export const describeCriterion = (id: string) => {
  const c = CRITERIA[id];
  return c ? `[${c.id} ${c.name}](${c.url}) (${c.level})` : id;
};
