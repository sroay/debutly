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
