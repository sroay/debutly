import { expect, it } from "vitest";
import { agentEmail } from "../src/run";

it("gives every agent a unique, readable address per run", () => {
  expect(agentEmail({ id: "p1", name: "Maya Chen" }, "run7", "agents.test")).toBe("maya-chen.p1.run7@agents.test");
  expect(agentEmail({ id: "p2", name: "Zoë" }, "run7", "agents.test")).toBe("zo.p2.run7@agents.test");
});
