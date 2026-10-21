import type { Action, Observation } from "../types";

export function describeAction(action: Action, obs: Observation): string {
  const target = (id: number) => {
    const el = obs.elements.find((e) => e.id === id);
    return el ? `${el.role} "${el.name}"` : `element #${id}`;
  };
  switch (action.type) {
    case "click":
      return `clicked ${target(action.id)}`;
    case "fill": {
      const el = obs.elements.find((e) => e.id === action.id);
      const picks = el && (el.tag === "select" || (el.role === "combobox" && el.tag !== "input" && el.tag !== "textarea"));
      return picks ? `chose "${action.text}" in ${target(action.id)}` : `typed "${action.text}" into ${target(action.id)}`;
    }
    case "upload":
      return `uploaded the sample ${action.file ?? "file"} with ${target(action.id)}`;
    case "goto":
      return `went to ${action.path}`;
    case "check_email":
      return "checked email";
    case "press":
      return `pressed ${action.key}`;
    case "wait":
      return "waited for the page to load";
    case "done":
      return `finished (${action.success ? "success" : "gave up"}): ${action.note}`;
  }
}
