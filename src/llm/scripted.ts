import type { LlmClient, LlmRequest } from "./types";

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export class ScriptedLlm implements LlmClient {
  readonly calls: LlmRequest[] = [];

  constructor(private readonly respond: (req: LlmRequest, callIndex: number) => string) {}

  async complete(req: LlmRequest): Promise<string> {
    const index = this.calls.length;
    this.calls.push(req);
    const reply = this.respond(req, index);
    // No provider to ask, so estimate: lets tests exercise metering and caps.
    req.onUsage?.({ inputTokens: estimateTokens(req.system + req.messages.map((m) => m.content).join("")), outputTokens: estimateTokens(reply) });
    return reply;
  }
}
