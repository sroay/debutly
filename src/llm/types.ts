export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /** What the provider actually charged in USD, when it says (OpenRouter does). */
  costUsd?: number;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  maxTokens?: number;
  /** Called with this request's token counts, so each session can meter its own spend. */
  onUsage?: (usage: LlmUsage) => void;
}

export interface LlmClient {
  complete(req: LlmRequest): Promise<string>;
}

export const OUT_OF_CREDITS = "The AI provider account is out of credits";

/**
 * The provider refused for lack of credit (OpenRouter's 402, Anthropic's "credit balance is too
 * low"). Every later call would be refused too, so clients raise it again without asking.
 */
export class OutOfCreditsError extends Error {
  constructor(detail: string) {
    super(`${OUT_OF_CREDITS}: ${detail.slice(0, 300)}`);
    this.name = "OutOfCreditsError";
  }
}
