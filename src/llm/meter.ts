import type { LlmUsage } from "./types";

/** USD per million tokens. */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

/** Running token count for a session or a run. */
export class Meter {
  private inputTokens = 0;
  private outputTokens = 0;
  private requests = 0;
  private charged = 0;
  private unchargedRequests = 0;

  add = (u: LlmUsage): void => {
    this.inputTokens += u.inputTokens;
    this.outputTokens += u.outputTokens;
    this.requests++;
    if (u.costUsd === undefined) this.unchargedRequests++;
    else this.charged += u.costUsd;
  };

  get total(): LlmUsage {
    return { inputTokens: this.inputTokens, outputTokens: this.outputTokens };
  }

  /**
   * What the provider charged when it reported every request's charge: that reflects caching,
   * the provider tier (e.g. Gemini flex) and routing. Otherwise an estimate from the list price;
   * undefined when that is unknown too.
   */
  costUsd(price: ModelPrice | null | undefined): number | undefined {
    if (this.requests > 0 && this.unchargedRequests === 0) return this.charged;
    if (!price) return undefined;
    return (this.inputTokens * price.inputPerMTok + this.outputTokens * price.outputPerMTok) / 1_000_000;
  }
}
