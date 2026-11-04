import { inclusionBrief } from "../persona/inclusion";
import { languageBrief } from "../persona/language";
import type { InteractiveElement, Observation, Persona } from "../types";
import { controlLabel, type StepView } from "./label";

export type { StepView } from "./label";

// Stays constant for the whole session so providers can cache it; everything that changes goes in the user message.
export interface AgentIdentity {
  email: string;
}

// `brief` carries shared context, e.g. the company a crew member works at and what their owner reported.
export function buildSystemPrompt(persona: Persona, goal: string, identity?: AgentIdentity, brief?: string): string {
  const email = identity
    ? `Your email address is ${identity.email}. Use it whenever the site asks for your email.
To read your inbox (for example a login link or a confirmation), reply {"type":"check_email"}. To open a link from an email, use its number: {"type":"goto","path":"email link 1"}.`
    : `Use emails at example.com.`;
  const about = [
    `You are ${persona.name}. ${persona.background}`,
    `Patience: ${persona.patience}. Tech savvy: ${persona.techSavvy}.`,
    persona.role ? `Your role: ${persona.role}.` : "",
    brief ?? "",
    persona.inclusion ? inclusionBrief(persona.inclusion) : "",
    languageBrief(persona.language),
  ]
    .filter(Boolean)
    .join("\n");
  return `${about}

You are a real prospective customer using this web product for the first time. Act exactly as this person would: read what is on screen, decide what they would do next, and react honestly to confusion or breakage. If something fails, try a reasonable alternative like a real person. Give up (done with success false) at the point this person would give up, and say why.

Your goal: ${goal}

${email}
Use test data only: card number 4242 4242 4242 4242. Never enter real personal or payment data.

Reply with exactly one JSON object: {"reasoning": string, "action": Action}
Action is one of:
{"type":"click","id":number}  (a "clickable" is text the page lets you click, such as a title that turns into a field to edit)
{"type":"fill","id":number,"text":string}  (on a select or dropdown, text is the option to choose)
{"type":"upload","id":number,"file":"photo"|"document"}  (attach a file through an upload button or file field: you have a sample photo and a sample CV/document)
{"type":"goto","path":string}
{"type":"press","key":"Escape"|"Enter"|"Space"|"Tab"|"ArrowDown"|"ArrowUp"}  (e.g. Escape closes a popup that blocks the page; Space presses the focused button or ticks a box)
{"type":"wait"}  (the page is still loading, e.g. a spinner or a form that has not appeared yet: wait a few seconds rather than leave)${identity ? `\n{"type":"check_email"}` : ""}
{"type":"done","success":boolean,"note":string}`;
}

/** A control's state, as a person sees it (and a screen reader announces it). */
function stateOf(e: InteractiveElement, behindOpenLayer = false): string {
  const states = [
    // Hidden from assistive technology while something is open: what a modal does to the page behind it.
    behindOpenLayer && e.ax?.hidden ? "behind what is open" : "",
    e.disabled ? "disabled" : "",
    e.readOnly ? "read-only" : "",
    e.checked === undefined ? "" : e.checked ? "checked" : "not checked",
    e.expanded === undefined ? "" : e.expanded ? "open" : "closed",
    e.filled ? "filled in" : "",
    !e.options && e.value ? `holds "${e.value}"` : "",
  ].filter(Boolean);
  return states.length ? ` (${states.join(", ")})` : "";
}

function describeElement(e: InteractiveElement, screenReader = false, behindOpenLayer = false): string {
  const line = `[${e.id}] ${controlLabel(e, screenReader)}${stateOf(e, behindOpenLayer)}`;
  if (!e.options) return line;
  return `${line} set to "${e.value ?? ""}", options: ${e.options.map((o) => `"${o}"`).join(" | ")}`;
}

export function buildStepMessage(obs: Observation, history: string[], view: StepView = {}): string {
  // Clickable text is no control to a screen reader: it is read out as text, and Tab passes it by.
  const shown = view.screenReader ? obs.elements.filter((e) => !e.ax?.hidden && e.role !== "clickable") : obs.elements;
  const elements = shown.map((e) => describeElement(e, view.screenReader, !!obs.openLayer)).join("\n");
  const past = history.length ? history.map((h, i) => `${i + 1}. ${h}`).join("\n") : "(none yet)";
  const open = obs.openLayer ? `\nOpen now: ${obs.openLayer}. It takes clicks outside it: finish it, choose from it or close it (Escape, or its close button) before using what is behind it.\n` : "";
  return `URL: ${obs.url}
Title: ${obs.title}
${open}
Interactive elements:
${elements}

Visible text:
${obs.text}

Your actions so far:
${past}

What do you do next?`;
}
