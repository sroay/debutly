import type { Locator, Page } from "playwright";
import type { Action, ActionResult, InteractiveElement, Observation } from "../types";
import { sampleFiles, sampleFor, type SampleKind } from "./samples";

const DESTRUCTIVE = /\b(delete|remove|destroy|deactivate|close account|cancel (my )?(subscription|account))\b/i;

// Agents never click anything named like this, whichever action would click it: a plain click,
// the button behind an upload, or a custom dropdown and the option chosen in it.
class Refused extends Error {}
function refuseDestructive(name: string): void {
  if (DESTRUCTIVE.test(name)) throw new Refused(`destructive action refused: "${name}"`);
}
// Every name the control goes by: Debutly's reading, and the one the browser gives assistive
// technology, which is what the screen-reader agent sees (a button holding only an image whose alt
// says "Delete workspace" has no name in the first and that one in the second).
function refuseDestructiveControl(el: InteractiveElement): void {
  refuseDestructive(el.name);
  if (el.ax) refuseDestructive(el.ax.name);
}

export const COVERED = "another element covers it";
export const NOT_BY_KEYBOARD = "can't be reached with the keyboard";
const WAIT_MS = 3_000;
const OPTION = '[role="option"]';

export interface ExecuteOptions {
  /**
   * Keyboard only, as a screen-reader user works: a control is used by moving focus to it (as
   * Tab would) and pressing Enter or Space, so one that isn't in the tab order can't be used.
   * Items inside lists, menus, tab lists and radio groups are reached with arrow keys, not Tab;
   * those are still chosen as a mouse would.
   */
  keyboard?: boolean;
}

// Roles reached with arrow keys inside their list, menu, tab list or group, not with Tab.
const ARROW_KEY_ITEMS = new Set(["option", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "treeitem", "radio", "input:radio"]);
// What Space presses; Enter presses the rest. Text fields and selects are only focused.
const SPACE_KEY = new Set(["checkbox", "input:checkbox", "switch"]);
const FOCUS_ONLY = /^(input:(text|email|password|number|search|tel|url|date|time|datetime-local|month|week)|textarea|select|combobox)$/;

// Is the focused element entirely hidden behind something else? Checks its middle and four points
// just inside its corners: WCAG 2.4.11 asks that focus is not entirely hidden. Returns what covers it.
const focusCoveredScript = (id: number) => `(() => {
  const el = document.querySelector('[data-debutly-id="${id}"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const points = [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]].map(([fx, fy]) => [r.left + r.width * fx, r.top + r.height * fy]);
  let cover = null;
  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    const hit = document.elementFromPoint(x, y);
    if (!hit || hit === el || el.contains(hit) || hit.contains(el)) return null;
    cover = cover || hit;
  }
  if (!cover) return 'the edge of the window';
  const classes = typeof cover.className === 'string' ? cover.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2) : [];
  const text = (cover.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 50);
  return cover.tagName.toLowerCase() + (cover.id ? '#' + cover.id : '') + classes.map((c) => '.' + c).join('') + (text ? ' ("' + text + '")' : '');
})()`;

class NotByKeyboard extends Error {}

/** Moves focus to the control as Tab would; refuses one that isn't in the tab order. Returns what hides it, if anything. */
async function focusByKeyboard(page: Page, locator: Locator, id: number): Promise<string | undefined> {
  const tabbable = await locator.evaluate((node) => (node as HTMLElement).tabIndex >= 0 && !node.closest("[inert]"), undefined, { timeout: 5_000 });
  if (!tabbable) throw new NotByKeyboard(`${NOT_BY_KEYBOARD}: it isn't in the tab order`);
  await locator.focus({ timeout: 5_000 });
  return ((await page.evaluate(focusCoveredScript(id))) as string | null) ?? undefined;
}

// Playwright's timeout message hides the cause in its call log; say it the way a person would notice it.
export function describeFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const covered = message.match(/(<[^\n]*?>)[^\n]*?(?: from [^\n]*? subtree)? intercepts pointer events/);
  if (covered) return `${COVERED}: ${covered[1].slice(0, 160)}`;
  if (/element is not enabled|element is disabled/.test(message)) return "the element is disabled";
  if (/element is not visible/.test(message)) return "the element is not visible";
  return message.split("\n")[0];
}

// When Playwright gives up waiting on an element it says only "Timeout exceeded", and an agent
// told that tries the same thing again. A person can see why: the field only opens for typing
// after its edit button, or the link is in a side menu that is shut. A string, like SCAN_SCRIPT.
const WHY_UNUSABLE_SCRIPT = (id: number) => `(() => {
  const el = document.querySelector('[data-debutly-id="${id}"]');
  if (!el) return 'gone';
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return 'disabled';
  if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.readOnly) return 'readonly';
  const style = getComputedStyle(el);
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0 || style.visibility === 'hidden') return 'hidden';
  if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return 'offscreen';
  return '';
})()`;

const UNUSABLE: Record<string, string> = {
  gone: "the element is no longer on the page",
  disabled: "the element is disabled",
  readonly: "the field is read-only, so it can't be typed in yet; there may be a button to edit it",
  hidden: "the element is not visible",
  offscreen: "it is off the screen, perhaps in a menu or panel that is closed; open that first",
};

async function explainTimeout(page: Page, id: number, err: unknown): Promise<string | undefined> {
  if (!/Timeout \d+ms exceeded/.test(err instanceof Error ? err.message : String(err))) return undefined;
  const why = (await page.evaluate(WHY_UNUSABLE_SCRIPT(id)).catch(() => "")) as string;
  return UNUSABLE[why];
}

// Playwright clicks an element's centre; a person clicks whatever part of it they can see.
async function clickVisiblePart(page: Page, id: number): Promise<boolean> {
  const locator = page.locator(`[data-debutly-id="${id}"]`);
  await locator.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => {});
  const box = await locator.boundingBox();
  if (!box) return false;
  for (const fy of [0.5, 0.25, 0.75]) {
    for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const x = box.x + box.width * fx;
      const y = box.y + box.height * fy;
      const reachable = await page.evaluate(
        ([px, py, target]) => {
          const hit = document.elementFromPoint(px, py);
          const el = document.querySelector(`[data-debutly-id="${target}"]`);
          return !!(hit && el && (hit === el || el.contains(hit)));
        },
        [x, y, id] as const,
      );
      if (reachable) {
        await page.mouse.click(x, y);
        return true;
      }
    }
  }
  return false;
}

// A native select's list is drawn outside the page, where arrow keys move a highlight the agent
// can't see: choose the option by its label, as a person picks what they read.
async function choose(select: Locator, text: string): Promise<void> {
  const labels = await select.evaluate((el) => Array.from((el as HTMLSelectElement).options, (o) => o.label));
  const label = labels[matchOption(labels, text)];
  refuseDestructive(label);
  await select.selectOption({ label }, { timeout: 5_000 });
}

/** The option a person would pick for `text`: the one it names, else the first containing it. */
function matchOption(labels: string[], text: string): number {
  const want = text.trim().toLowerCase();
  let i = labels.findIndex((l) => l.trim().toLowerCase() === want);
  if (i === -1) i = labels.findIndex((l) => l.toLowerCase().includes(want));
  if (i === -1) throw new Error(`no option "${text}"; the options are ${labels.map((l) => `"${l}"`).join(", ")}`);
  return i;
}

/** The options of the dropdown that is open now: each visible role="option", with its position. */
async function openOptions(page: Page): Promise<{ label: string; nth: number }[]> {
  const all = await page.locator(OPTION).evaluateAll((els) =>
    els.map((el) => ({
      label: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
      visible: typeof el.checkVisibility === "function" ? el.checkVisibility() : (el as HTMLElement).offsetParent !== null,
    })),
  );
  return all.flatMap((o, nth) => (o.visible ? [{ label: o.label, nth }] : []));
}

// A custom dropdown (a button or div with role="combobox", as Radix and shadcn build them) takes
// no typing: a person opens it and clicks the option they read. Agents typed into them and got
// "Element is not an <input>" again and again, until the report called the page stuck.
async function pick(page: Page, trigger: Locator, text: string): Promise<void> {
  const appear = () => page.locator(OPTION).first().waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  if (!(await openOptions(page)).length) {
    await trigger.click({ timeout: 5_000 });
    await appear();
  }
  // Some open on a key rather than a click.
  if (!(await openOptions(page)).length) {
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await appear();
  }
  const options = await openOptions(page);
  if (!options.length) throw new Error("the dropdown shows no options");
  let chosen: { label: string; nth: number };
  try {
    chosen = options[matchOption(options.map((o) => o.label), text)];
    refuseDestructive(chosen.label);
  } catch (err) {
    await page.keyboard.press("Escape"); // leave it closed, as a person who found nothing would
    throw err;
  }
  await page.locator(OPTION).nth(chosen.nth).click({ timeout: 5_000 });
}

// A key can click too:
// - Enter activates the focused button or link, or the option a combobox highlights
//   (aria-activedescendant);
// - Enter in a form field submits its form through the form's default button, which may sit
//   outside the form (form="…"), or with no button through the form itself;
// - an arrow key moves a focused native select to the next option.
// Each thing the key would set off is listed with every name it goes by (aria-label, the elements
// aria-labelledby points at, labels, text, value, title) and its data-debutly-id, so the check also
// sees the name agents see. With nothing interactive focused there is nothing: the page's own text
// is not a button. A string, like SCAN_SCRIPT: tsx injects helpers into functions the page lacks.
const keyTargetsScript = (key: string) => `(() => {
  const key = ${JSON.stringify(key)};
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return [];
  const targets = [];
  const add = (e) => {
    if (!e) return;
    const names = [e.getAttribute('aria-label'), e.getAttribute('title')];
    for (const ref of (e.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean)) {
      const r = document.getElementById(ref);
      if (r) names.push(r.textContent);
    }
    if (e.labels) for (const l of e.labels) names.push(l.textContent);
    if (e.tagName === 'INPUT' || e.tagName === 'BUTTON') names.push(e.value);
    if (e.tagName !== 'INPUT') names.push(e.innerText);
    targets.push({ id: e.getAttribute('data-debutly-id'), names: names.filter((n) => n && n.trim()) });
  };
  if (key === 'Enter') {
    const active = el.getAttribute('aria-activedescendant');
    if (active) add(document.getElementById(active));
    const field = el.tagName === 'INPUT' && !['submit', 'button', 'reset', 'image'].includes(el.type);
    if (field && el.form) {
      const button = Array.from(el.form.elements).find((e) =>
        (e.tagName === 'BUTTON' && e.type === 'submit') || (e.tagName === 'INPUT' && (e.type === 'submit' || e.type === 'image')));
      if (button) add(button);
      else targets.push({ id: null, names: [el.form.getAttribute('aria-label'), el.form.getAttribute('name'), el.form.getAttribute('action')].filter((n) => n && n.trim()) });
    } else if (!field && el.matches('a, button, input, summary, [role="button"], [role="link"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="tab"]')) {
      add(el);
    }
  }
  if ((key === 'ArrowDown' || key === 'ArrowUp') && el.tagName === 'SELECT') {
    const next = el.options[el.selectedIndex + (key === 'ArrowDown' ? 1 : -1)];
    if (next) targets.push({ id: null, names: [next.label] });
  }
  return targets;
})()`;

async function namesAKeyWouldActivate(page: Page, key: string, obs: Observation): Promise<string[]> {
  const targets = (await page.evaluate(keyTargetsScript(key))) as { id: string | null; names: string[] }[];
  return targets.flatMap((t) => [...t.names, ...obs.elements.filter((e) => t.id !== null && String(e.id) === t.id).flatMap((e) => [e.name, e.ax?.name ?? ""])]);
}

// Attach a sample file, as a person picks one from their computer. A visible file field takes it
// directly; an upload button, label or drop zone opens the file picker, which is answered.
// Without this an agent asked for a photo (an Instagram post needs one) could only give up.
async function upload(page: Page, target: Locator, isFileField: boolean, wanted?: SampleKind): Promise<void> {
  const files = await sampleFiles();
  if (isFileField) {
    await target.setInputFiles(files[wanted ?? sampleFor(await target.getAttribute("accept"))], { timeout: 5_000 });
    return;
  }
  const chooser = page.waitForEvent("filechooser", { timeout: 5_000 }).catch(() => null);
  await target.click({ timeout: 5_000 });
  const picker = await chooser;
  if (!picker) throw new Error("clicking it opened no file picker");
  await picker.setFiles(files[wanted ?? sampleFor(await picker.element().getAttribute("accept"))]);
}

export async function execute(
  page: Page,
  action: Action,
  obs: Observation,
  origin: string,
  // Links the agent received by email (e.g. a magic link to the auth server) may leave the app's origin.
  allowUrl: (href: string) => boolean = () => false,
  opts: ExecuteOptions = {},
): Promise<ActionResult> {
  const result: ActionResult = {};
  try {
    switch (action.type) {
      case "click":
      case "fill": {
        const el = obs.elements.find((e) => e.id === action.id);
        if (!el) return { error: `no element with id ${action.id}` };
        const customDropdown = el.tag !== "select" && el.role === "combobox" && el.tag !== "input" && el.tag !== "textarea";
        if (action.type === "click" || customDropdown) refuseDestructiveControl(el);
        const locator = page.locator(`[data-debutly-id="${action.id}"]`);
        const byKeyboard = opts.keyboard && !ARROW_KEY_ITEMS.has(el.role);
        if (byKeyboard) result.focusObscured = await focusByKeyboard(page, locator, action.id);
        if (action.type === "click" && byKeyboard) {
          if (!FOCUS_ONLY.test(el.role)) await page.keyboard.press(SPACE_KEY.has(el.role) ? "Space" : "Enter");
        } else if (action.type === "click") {
          try {
            await locator.click({ timeout: 5_000 });
          } catch (err) {
            if (!describeFailure(err).startsWith(COVERED) || !(await clickVisiblePart(page, action.id))) throw err;
          }
        } else if (el.tag === "select") await choose(locator, action.text);
        else if (customDropdown) await pick(page, locator, action.text);
        else await locator.fill(action.text, { timeout: 5_000 });
        break;
      }
      case "upload": {
        const el = obs.elements.find((e) => e.id === action.id);
        if (!el) return { error: `no element with id ${action.id}` };
        if (el.role !== "input:file") refuseDestructiveControl(el);
        const target = page.locator(`[data-debutly-id="${action.id}"]`);
        // A drop zone or label a keyboard can't reach can't open the file picker for a keyboard user.
        if (opts.keyboard && el.role !== "input:file") result.focusObscured = await focusByKeyboard(page, target, action.id);
        await upload(page, target, el.role === "input:file", action.file);
        break;
      }
      case "goto": {
        const target = new URL(action.path, origin);
        if (target.origin !== new URL(origin).origin && !allowUrl(target.href)) {
          return { blocked: `off-origin navigation refused: ${target.href}` };
        }
        await page.goto(target.href);
        break;
      }
      case "press":
        for (const name of await namesAKeyWouldActivate(page, action.key, obs)) refuseDestructive(name);
        await page.keyboard.press(action.key);
        break;
      case "wait":
        // A few seconds more than the settle before every look (runSession) already gives.
        await page.waitForTimeout(WAIT_MS);
        break;
      case "done":
      case "check_email":
        return {};
    }
    await page.waitForLoadState("domcontentloaded");
    // Let async handlers (fetch after submit, deferred errors) surface their signals.
    await page.waitForTimeout(300);
    return result.focusObscured ? result : {};
  } catch (err) {
    if (err instanceof Refused) return { blocked: err.message };
    if (err instanceof NotByKeyboard) return { error: err.message };
    const why = "id" in action ? await explainTimeout(page, action.id, err) : undefined;
    return { error: why ?? describeFailure(err), ...(result.focusObscured ? { focusObscured: result.focusObscured } : {}) };
  }
}
