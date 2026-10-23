import { inclusionBrief } from "../persona/inclusion";
import { languageBrief } from "../persona/language";
import type { InteractiveElement, Observation, Persona } from "../types";

// Stays constant for the whole session so providers can cache it; everything that changes goes in the user message.
export interface AgentIdentity {
  email: string;
}

// `brief` carries shared context, e.g. the company a crew member works at and what their owner reported.
export function buildSystemPrompt(persona: Persona, goal: string, identity?: AgentIdentity, brief?: string): string {
  const email = identity
    ? `Your email address is ${identity.email}. Use it whenever the site asks for your email.
To read your inbox (for example a login link or a confirmation), reply {"type":"check_email"}. To open a link from an email, use {"type":"goto","path":"<the full link>"}.`
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
{"type":"click","id":number}
{"type":"fill","id":number,"text":string}  (on a select or dropdown, text is the option to choose)
{"type":"upload","id":number,"file":"photo"|"document"}  (attach a file through an upload button or file field: you have a sample photo and a sample CV/document)
{"type":"goto","path":string}
{"type":"press","key":"Escape"|"Enter"|"Tab"|"ArrowDown"|"ArrowUp"}  (e.g. Escape closes a popup that blocks the page)
{"type":"wait"}  (the page is still loading, e.g. a spinner or a form that has not appeared yet: wait a few seconds rather than leave)${identity ? `\n{"type":"check_email"}` : ""}
{"type":"done","success":boolean,"note":string}`;
}

function describeElement(e: InteractiveElement, screenReader = false): string {
  // A screen reader announces the role and name the browser gives it.
  const heard = screenReader && e.ax ? e.ax : e;
  const line = `[${e.id}] ${heard.role} "${heard.name}"`;
  if (!e.options) return line;
  return `${line} set to "${e.value ?? ""}", options: ${e.options.map((o) => `"${o}"`).join(" | ")}`;
}

export interface StepView {
  /** As a screen reader presents the page: the browser's names and roles, without what is hidden from it. */
  screenReader?: boolean;
}

export function buildStepMessage(obs: Observation, history: string[], view: StepView = {}): string {
  const shown = view.screenReader ? obs.elements.filter((e) => !e.ax?.hidden) : obs.elements;
  const elements = shown.map((e) => describeElement(e, view.screenReader)).join("\n");
  const past = history.length ? history.map((h, i) => `${i + 1}. ${h}`).join("\n") : "(none yet)";
  return `URL: ${obs.url}
Title: ${obs.title}

Interactive elements:
${elements}

Visible text:
${obs.text}

Your actions so far:
${past}

What do you do next?`;
}
