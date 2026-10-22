import Anthropic from "@anthropic-ai/sdk";
import { OutOfCreditsError, type LlmClient, type LlmRequest } from "./types";

export type MessagesClient = Pick<Anthropic, "messages">;

const LOW_BALANCE = /credit balance is too low/i;

export class AnthropicLlm implements LlmClient {
  private outOfCredits?: OutOfCreditsError;

  constructor(
    private readonly client: MessagesClient,
    readonly model: string,
  ) {}

  static fromApiKey(apiKey: string, model: string): AnthropicLlm {
    return new AnthropicLlm(new Anthropic({ apiKey }), model);
  }

  async complete(req: LlmRequest): Promise<string> {
    if (this.outOfCredits) throw this.outOfCredits;
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        messages: req.messages,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (LOW_BALANCE.test(message)) throw (this.outOfCredits = new OutOfCreditsError(message));
      throw err;
    }
    if (response.usage) req.onUsage?.({ inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
    if (response.stop_reason === "refusal") {
      throw new Error("LLM refused the request");
    }
    return response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  }
}
