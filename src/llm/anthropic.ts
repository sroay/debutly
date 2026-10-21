import Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, LlmRequest } from "./types";

export type MessagesClient = Pick<Anthropic, "messages">;

export class AnthropicLlm implements LlmClient {
  constructor(
    private readonly client: MessagesClient,
    readonly model: string,
  ) {}

  static fromApiKey(apiKey: string, model: string): AnthropicLlm {
    return new AnthropicLlm(new Anthropic({ apiKey }), model);
  }

  async complete(req: LlmRequest): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: req.messages,
    });
    if (response.usage) req.onUsage?.({ inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
    if (response.stop_reason === "refusal") {
      throw new Error("LLM refused the request");
    }
    return response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  }
}
