import type { Observation, Step } from "../types";

// What a person who wants to get in presses before giving up: to go on, join, sign in or start.
// Arabic too, as agents often use Arabic interfaces.
const WAY_ON =
  /^(continue|next|proceed|join\b.*|accept\b.*|sign ?in|log ?in|sign ?up|create (an )?account|get started|start|confirm|verify|submit|استمر|متابعة|التالي|انضم.*|قبول.*|تسجيل الدخول|إنشاء حساب|ابدأ.*|تأكيد|إرسال)$/i;
// Buttons only: a page's own way on. A "Sign up" link in the site's menu is not one from where it stands.
const PRESSABLE = /^(button|input:(submit|button))$/;

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

/**
 * The ways on that an agent about to give up hasn't tried on the page it is on: enabled buttons
 * named like Continue, Join or Sign in that it hasn't pressed since it came to this page.
 * A teammate agent gave up on Twenty's invite page saying there was "no way into the workspace",
 * with a Continue button under its eyes (2026-10-25), and the report blamed the app.
 */
export function untriedWaysOn(obs: Observation, steps: Step[], screenReader = false): string[] {
  const path = pathOf(obs.url);
  const pressed = new Set<string>();
  for (let i = steps.length - 1; i >= 0 && pathOf(steps[i].observation.url) === path; i--) {
    const { action, observation } = steps[i];
    if (action.type !== "click") continue;
    const el = observation.elements.find((e) => e.id === action.id);
    if (el) pressed.add((el.ax?.name || el.name).trim().toLowerCase());
  }
  const names = obs.elements
    .filter((e) => PRESSABLE.test(e.role) && !e.disabled && !(screenReader && e.ax?.hidden))
    .map((e) => (screenReader && e.ax ? e.ax.name : e.name || e.ax?.name || "").trim())
    .filter((name) => WAY_ON.test(name) && !pressed.has(name.toLowerCase()));
  return [...new Set(names)].slice(0, 3);
}
