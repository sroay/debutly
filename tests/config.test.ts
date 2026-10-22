import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { configArgs, readConfig } from "../src/config";

it("turns debutly.json into the run's flags", () => {
  expect(
    configArgs({ $schema: "https://debutly.dev/schema.json", url: "http://localhost:3000", goal: "Sign up", maxCost: 1, sandboxOutbox: "http://localhost:3000/api/sandbox/outbox", inclusion: false }),
  ).toEqual(["--url", "http://localhost:3000", "--goal", "Sign up", "--max-cost", "1", "--sandbox-outbox", "http://localhost:3000/api/sandbox/outbox", "--inclusion", "off"]);
});

it("names the settings when one is misspelt, and keeps secrets out of the file", () => {
  expect(() => configArgs({ maxcost: 1 } as never)).toThrow(/"maxcost" is not a setting\. Settings: url, goal/);
  // The store's address carries a password: it belongs in DEBUTLY_STORE_URL.
  expect(() => configArgs({ store: "postgres://u:p@h/db" } as never)).toThrow(/"store" is not a setting/);
});

it("reads the file from a folder, if there is one", () => {
  const dir = mkdtempSync(join(tmpdir(), "debutly-config-"));
  expect(readConfig(dir)).toBeUndefined();
  writeFileSync(join(dir, "debutly.json"), '{"url": "http://localhost:3000"}');
  expect(readConfig(dir)).toEqual({ url: "http://localhost:3000" });
  writeFileSync(join(dir, "debutly.json"), '{"url": ');
  expect(() => readConfig(dir)).toThrow(/^debutly\.json can't be read/);
});
