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
  return ReplySchema.parse(actionAsObject(parseQuotedAction(raw.slice(start, end + 1))));
}

// Some models (GLM 5.3 Flash) send the action as a string. Unescaped,
// {"reasoning":"…","action":"{"type":"fill","id":1,"text":"x"}"} is not JSON at all, and asking
// again got the same reply three times, ending the agent. An action is a flat object, so its
// quotes can be dropped and the rest parsed as meant.
function parseQuotedAction(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    const unquoted = text.replace(/("action"\s*:\s*)"(\{[^{}]*\})"/, "$1$2");
    if (unquoted === text) throw err;
    try {
      return JSON.parse(unquoted);
    } catch {
      throw err;
    }
  }
}

// Escaped, the same mistake parses, with the action as a string holding its JSON.
function actionAsObject(reply: unknown): unknown {
  if (!reply || typeof reply !== "object" || typeof (reply as { action?: unknown }).action !== "string") return reply;
  try {
    return { ...reply, action: JSON.parse((reply as { action: string }).action) };
  } catch {
    return reply; // the schema says what is wrong with it
  }
}
