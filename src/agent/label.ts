import type { InteractiveElement } from "../types";

// Apart from prompt.ts, which needs the browser (Playwright) through the inclusion briefs: the
// dashboard imports effect.ts, and its build has no Playwright.

export interface StepView {
  /** As a screen reader presents the page: the browser's names and roles, without what is hidden from it. */
  screenReader?: boolean;
}

/**
 * A control as the agent meets it. A screen reader announces the role and name the browser gives
 * it; a sighted person looking at a control with no text sees its icon.
 */
export function controlLabel(e: InteractiveElement, screenReader = false): string {
  const heard = screenReader && e.ax ? e.ax : e;
  const icon = !screenReader && !e.name && e.icon ? ` (${e.icon} icon)` : "";
  return `${heard.role} "${heard.name}"${icon}`;
}
