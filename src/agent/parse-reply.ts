import { z } from "zod";
import { PRESS_KEYS, type Action } from "../types";

const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), id: z.number().int() }),
  z.object({ type: z.literal("fill"), id: z.number().int(), text: z.string() }),
  z.object({ type: z.literal("upload"), id: z.number().int(), file: z.enum(["photo", "document"]).optional() }),
  z.object({ type: z.literal("goto"), path: z.string() }),
  z.object({ type: z.literal("check_email") }),
  z.object({ type: z.literal("press"), key: z.enum(PRESS_KEYS) }),
  z.object({ type: z.literal("wait") }),
  z.object({ type: z.literal("done"), success: z.boolean(), note: z.string() }),
]);

// Real models sometimes drop the reasoning; the action is what matters.
const ReplySchema = z.object({ reasoning: z.string().default(""), action: ActionSchema });

export function parseAgentReply(raw: string): { reasoning: string; action: Action } {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in agent reply");
  const reply = actionAsObject(parseQuotedAction(raw.slice(start, end + 1)));
  const parsed = ReplySchema.safeParse(reply);
  if (!parsed.success) throw new Error(problemWith(reply, parsed.error));
  return parsed.data;
}

// Said back to the agent when it is asked again, so in words it can act on. Shown the validator's
// own JSON for a reply with reasoning and no action, one model sent the same reply three times.
function problemWith(reply: unknown, error: z.ZodError): string {
  if (reply && typeof reply === "object" && !("action" in reply)) {
    return `the reply has no "action". Add one, for example {"reasoning":"…","action":{"type":"wait"}}`;
  }
  return error.issues.map((i) => `${i.path.join(".") || "reply"}: ${i.message}`).join("; ");
}

/**
 * The reply split into objects one after another, merged: {"reasoning":"…"} and on the next line
 * {"action":"press","key":"Enter"} (GLM 5.3 Flash, 2026-10-24, twice in one run). When two whole
 * replies come, the first one counts. Undefined when there is only one object or one doesn't parse.
 */
function splitReply(text: string): Record<string, unknown> | undefined {
  const objects: string[] = [];
  let depth = 0;
  let from = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{" && depth++ === 0) from = i;
    else if (c === "}" && depth > 0 && --depth === 0) objects.push(text.slice(from, i + 1));
  }
  if (objects.length < 2) return undefined;
  try {
    const parsed = objects.map((o) => JSON.parse(o) as unknown);
    if (!parsed.every((p) => p && typeof p === "object" && !Array.isArray(p))) return undefined;
    return Object.assign({}, ...(parsed as Record<string, unknown>[]).reverse());
  } catch {
    return undefined;
  }
}

// Some models (GLM 5.3 Flash) send the action as a string. Unescaped,
// {"reasoning":"…","action":"{"type":"fill","id":1,"text":"x"}"} is not JSON at all, and asking
// again got the same reply three times, ending the agent. An action is a flat object, so its
// quotes can be dropped and the rest parsed as meant. Sometimes the closing quote and brace never
// come at all; then the reasoning and the action are read out separately.
function parseQuotedAction(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    const split = splitReply(text);
    if (split) return split;
    const unquoted = text.replace(/("action"\s*:\s*)"(\{[^{}]*\})"/, "$1$2");
    if (unquoted !== text) {
      try {
        return JSON.parse(unquoted);
      } catch {
        // fall through to reading the parts
      }
    }
    const parts = readParts(text);
    if (!parts) throw err;
    return parts;
  }
}

function readParts(text: string): { reasoning: string; action: unknown } | undefined {
  const action = text.match(/"action"\s*:\s*"?\s*(\{[^{}]*\})/)?.[1];
  if (!action) return undefined;
  const reasoning = text.match(/"reasoning"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  try {
    return { reasoning: reasoning ? JSON.parse(`"${reasoning}"`) : "", action: JSON.parse(action.replace(/\\"/g, '"')) };
  } catch {
    return undefined;
  }
}

const ACTION_TYPES = new Set(["click", "fill", "upload", "goto", "check_email", "press", "wait", "done"]);
const ACTION_FIELDS = ["id", "text", "file", "path", "key", "success", "note"] as const;

// Escaped, the same mistake parses, with the action as a string holding its JSON. Or the action is
// flattened into the reply, {"reasoning":"…","action":"click","id":40}: its type as a string, its
// fields beside it (2026-10-18; asking again got the same reply).
function actionAsObject(reply: unknown): unknown {
  if (!reply || typeof reply !== "object" || typeof (reply as { action?: unknown }).action !== "string") return reply;
  const r = reply as Record<string, unknown> & { action: string };
  try {
    return { ...r, action: JSON.parse(r.action) };
  } catch {
    if (!ACTION_TYPES.has(r.action)) return reply; // the schema says what is wrong with it
    const action: Record<string, unknown> = { type: r.action };
    for (const field of ACTION_FIELDS) if (field in r) action[field] = r[field];
    return { reasoning: r.reasoning, action };
  }
}
