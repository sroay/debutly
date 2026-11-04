import type { Action, InteractiveElement, Observation } from "../types";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * How a control is named in an agent's words: whole when short, by its first words when its name
 * runs on into a description ("Email alerts Get notified of hiring changes" is "email alerts").
 */
function mentionOf(name: string): string {
  const n = norm(name);
  if (n.length <= 30) return n;
  const words = n.split(" ");
  const two = words.slice(0, 2).join(" ");
  return two.length >= 8 ? two : words.slice(0, 3).join(" ");
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether the agent's words name the control. A one-word name counts only as written on the
 * control (its capitals), so "go back" in passing isn't the "Back" button.
 */
function said(reasoning: string, name: string): boolean {
  const m = mentionOf(name);
  if (m.length < 3) return false;
  if (m.includes(" ")) return norm(reasoning).includes(m);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name.trim())}($|[^\\p{L}\\p{N}])`, "u").test(reasoning);
}

const nameOf = (e: InteractiveElement, screenReader: boolean) => (screenReader && e.ax ? e.ax.name : e.name || e.ax?.name || "");

/**
 * When an agent's reasoning names controls on the page but its action points at another one: the
 * controls it named. An agent in a product's onboarding wrote "I will click the button for email
 * alerts" and then "select 'Competitor'", and both times sent the id of the logo, which restarted
 * onboarding; it gave up blaming the app (2026-10-25). Undefined when the action matches what it
 * said, or when there is nothing to compare (no id, or a control without a name).
 */
export function saidOtherControl(reasoning: string, action: Action, obs: Observation, screenReader = false): string[] | undefined {
  if (action.type !== "click" && action.type !== "fill") return undefined;
  const chosen = obs.elements.find((e) => e.id === action.id);
  if (!chosen) return undefined;
  const chosenName = nameOf(chosen, screenReader);
  if (!chosenName.trim() || said(reasoning, chosenName)) return undefined;
  // A field filled with text it names ("type Agency into Industry") is fine either way.
  if (action.type === "fill" && norm(reasoning).includes(norm(action.text))) return undefined;
  const meant = obs.elements
    .filter((e) => e.id !== chosen.id && nameOf(e, screenReader).trim().length >= 4 && said(reasoning, nameOf(e, screenReader)))
    .map((e) => nameOf(e, screenReader).trim());
  return meant.length ? [...new Set(meant)].slice(0, 3) : undefined;
}
