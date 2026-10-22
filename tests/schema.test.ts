import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { configArgs } from "../src/config";

const schema = JSON.parse(readFileSync("site/schema.json", "utf8")) as { properties: Record<string, unknown> };

it("describes exactly the settings debutly.json accepts", () => {
  const described = Object.keys(schema.properties).filter((k) => k !== "$schema");
  // Every setting the schema describes is one a run accepts...
  expect(() => configArgs(Object.fromEntries(described.map((k) => [k, "x"])))).not.toThrow();
  // ...and every setting a run accepts is described: config.ts names them in its error.
  const accepted = (() => {
    try {
      configArgs({ notASetting: 1 } as never);
    } catch (err) {
      return String((err as Error).message).replace(/.*Settings: /, "").replace(/\.$/, "").split(", ");
    }
    return [];
  })();
  expect(described.sort()).toEqual(accepted.sort());
});
