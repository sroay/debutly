// Run by tsx-runtime.test.ts under tsx, as real runs are. tsx injects helpers (e.g. __name) into
// named functions; code that runs in the page doesn't have them, so in-page code passed as a
// function breaks under tsx even when vitest passes. Prints each action's result as JSON.
import { chromium } from "playwright";
import { execute } from "../../src/browser/execute";
import { observe } from "../../src/browser/observe";

const browser = await chromium.launch();
const page = await browser.newPage();
const results: Record<string, unknown> = {};
const idOf = (els: { id: number; name: string }[], name: string) => els.find((e) => e.name === name)!.id;

await page.setContent(`
  <form onsubmit="return false"><input aria-label="Email"><button>Sign up</button></form>
  <label>Plan <select><option>Solo</option><option>Team</option></select></label>
  <span id="c">Country</span>
  <button id="t" role="combobox" aria-labelledby="c" aria-controls="l" onclick="l.hidden = !l.hidden">Choose</button>
  <ul id="l" role="listbox" hidden><li role="option" onclick="l.hidden = true">India</li></ul>`);
let obs = await observe(page);
results.observe = obs.elements.length;
await page.getByLabel("Email").focus();
results.press = await execute(page, { type: "press", key: "Enter" }, obs, "http://x.test");
results.choose = await execute(page, { type: "fill", id: idOf(obs.elements, "Plan"), text: "Team" }, obs, "http://x.test");
obs = await observe(page);
results.pick = await execute(page, { type: "fill", id: idOf(obs.elements, "Country"), text: "India" }, obs, "http://x.test");
await browser.close();
console.log(JSON.stringify(results));
