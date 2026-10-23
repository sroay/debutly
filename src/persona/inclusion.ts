import type { Browser, BrowserContext, Page } from "playwright";
import { INCLUSION_NEEDS, type CustomerUnit, type InclusionNeed, type Persona } from "../types";

const BRIEFS: Record<InclusionNeed, string> = {
  screen_reader:
    'You are blind and use a screen reader with your keyboard; you cannot use a mouse. You only know what it announces: element roles and names, and the page text. A button or link with an empty name is announced only as "button" or "link", so you cannot tell what it does; avoid it unless you have no other choice. You reach controls with the Tab key, so one the keyboard cannot reach is one you cannot use.',
  low_vision:
    "You have low vision and browse zoomed in to 200%, so pages look cramped and you often have to scroll. Small or low-contrast controls are hard for you to find.",
  slow_connection:
    "You are on a slow, unreliable mobile connection. Pages take several seconds to load; you wait a while before assuming something is broken, but not forever.",
  non_native_english:
    "English is not your first language. You read carefully and slowly, jargon and idioms confuse you, and you sometimes make small typing mistakes.",
};

export const inclusionBrief = (need: InclusionNeed) => BRIEFS[need];

/** Assigns one need to each of the first agents of a run (owner before employees), starting at `offset` so needs rotate between runs. */
export function withInclusion(units: CustomerUnit[], offset: number): CustomerUnit[] {
  let next = 0;
  const assign = (p: Persona): Persona => {
    if (next >= INCLUSION_NEEDS.length) return p;
    const inclusion = INCLUSION_NEEDS[(offset + next++) % INCLUSION_NEEDS.length];
    return { ...p, inclusion };
  };
  return units.map((u) =>
    u.kind === "individual" ? { ...u, person: assign(u.person) } : { ...u, owner: assign(u.owner), employees: u.employees.map(assign) },
  );
}

// Chrome DevTools' "Slow 3G"-like: 400 ms round trips, 500 kbit/s each way.
const SLOW_NETWORK = { offline: false, latency: 400, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 };
const SLOW_NAVIGATION_MS = 90_000;

/** A fresh browser context and page for one agent, shaped by its inclusion need. */
export async function openAgentPage(browser: Browser, need?: InclusionNeed): Promise<{ context: BrowserContext; page: Page }> {
  // 200% zoom on a 1280×800 laptop lays pages out like a 640×400 viewport.
  const context = await browser.newContext(need === "low_vision" ? { viewport: { width: 640, height: 400 } } : {});
  const page = await context.newPage();
  if (need === "slow_connection") {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", SLOW_NETWORK);
    // At 500 kbit/s a page can take longer than Playwright's 30 s default to arrive; a person on
    // that connection waits, so the agent's navigations do too.
    page.setDefaultNavigationTimeout(SLOW_NAVIGATION_MS);
  }
  return { context, page };
}
