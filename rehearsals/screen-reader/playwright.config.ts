import { devices } from "@playwright/test";
import { withGuidepup } from "@guidepup/playwright";

// One screen reader, one browser, one test at a time: NVDA reads whatever window is in front.
export default withGuidepup({
  testDir: "checks",
  timeout: 10 * 60 * 1000,
  retries: 1,
  reporter: "list",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
