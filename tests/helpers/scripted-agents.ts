import { ScriptedLlm } from "../../src/llm/scripted";
import type { Action, Persona } from "../../src/types";

export type Intent =
  | { click: string }
  | { fill: [label: string, text: string] }
  | { goto: string }
  | { checkEmail: true }
  // Opens the most recent link the agent saw in its inbox.
  | { openEmailLink: true }
  | { done: [success: boolean, note: string] };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Drives agents deterministically by element NAME, the way a real model reads the page.
// In fill text, {email:<Name>} becomes the address the prompt gives for that teammate.
export function scriptedAgents(scripts: Record<string, Intent[]>): ScriptedLlm {
  const cursor = new Map<string, number>();
  return new ScriptedLlm((req) => {
    const name = req.system.match(/^You are ([^.]+)\./)?.[1] ?? "";
    const script = scripts[name];
    if (!script) throw new Error(`no script for persona "${name}"`);
    const i = cursor.get(name) ?? 0;
    cursor.set(name, i + 1);
    const intent: Intent = script[i] ?? { done: [false, "script exhausted"] };
    const page = req.messages[0].content;
    const idOf = (label: string) => {
      const m = page.match(new RegExp(`\\[(\\d+)\\] \\S+ "${escapeRe(label)}"`));
      if (!m) throw new Error(`"${label}" not on page for ${name}:\n${page}`);
      return Number(m[1]);
    };
    let action: Action;
    const teammateEmail = (who: string) => {
      const m = req.system.match(new RegExp(`${escapeRe(who)} \\([^)]*\\) at ([^\\s;]+)`));
      if (!m) throw new Error(`no address for ${who} in ${name}'s prompt`);
      return m[1].replace(/\.$/, "");
    };
    if ("click" in intent) action = { type: "click", id: idOf(intent.click) };
    else if ("fill" in intent)
      action = { type: "fill", id: idOf(intent.fill[0]), text: intent.fill[1].replace(/\{email:([^}]+)\}/g, (_, who: string) => teammateEmail(who)) };
    else if ("openEmailLink" in intent) {
      const links = [...page.matchAll(/links: (\S+)/g)];
      if (!links.length) throw new Error(`no emailed link seen by ${name}`);
      action = { type: "goto", path: links[links.length - 1][1] };
    }
    else if ("goto" in intent) action = { type: "goto", path: intent.goto };
    else if ("checkEmail" in intent) action = { type: "check_email" };
    else action = { type: "done", success: intent.done[0], note: intent.done[1] };
    return JSON.stringify({ reasoning: `scripted step ${i}`, action });
  });
}

export const persona = (id: string, name: string): Persona => ({
  id,
  name,
  background: "A test persona.",
  goal: "Test the product.",
  patience: "medium",
  techSavvy: "medium",
});
