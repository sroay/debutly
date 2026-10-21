import { expect, it } from "vitest";
import { ScriptedLlm } from "../../src/llm/scripted";

it("returns scripted replies and records calls", async () => {
  const llm = new ScriptedLlm((_req, i) => `reply ${i}`);
  const req = { system: "sys", messages: [{ role: "user" as const, content: "hi" }] };
  expect(await llm.complete(req)).toBe("reply 0");
  expect(await llm.complete(req)).toBe("reply 1");
  expect(llm.calls).toHaveLength(2);
  expect(llm.calls[0].system).toBe("sys");
});
