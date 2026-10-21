import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "./db";
import * as t from "./schema";

export type PredictionMetric = "winner" | "top_objection" | "intent_share";

export interface NewPrediction {
  metric: PredictionMetric;
  claim: string;
  predicted: Record<string, unknown>;
}

export interface StoredPrediction extends NewPrediction {
  id: string;
  runId: string;
  actual: unknown;
  correct: boolean | null;
  createdAt: Date;
  checkedAt: Date | null;
}

/** Whether a real outcome matches the prediction; null where we can't score it yet. */
function isCorrect(metric: string, predicted: Record<string, unknown>, actual: string): boolean | null {
  if (metric === "winner") return String(predicted.winner) === actual.trim();
  if (metric === "top_objection") return String(predicted.category) === actual.trim();
  // Shares (e.g. intent) are not conversion rates; they are scored once calibration exists.
  return null;
}

/** Design §8 Calibration Loop: verdicts as predictions, checked against real outcomes. */
export class PgPredictionStore {
  constructor(private readonly db: Db) {}

  async add(runId: string, items: NewPrediction[]): Promise<string[]> {
    if (!items.length) return [];
    const rows = await this.db
      .insert(t.predictions)
      .values(items.map((p) => ({ runId, metric: p.metric, claim: p.claim, predicted: p.predicted })))
      .returning({ id: t.predictions.id });
    return rows.map((r) => r.id);
  }

  async list(o: { unresolved?: boolean } = {}): Promise<StoredPrediction[]> {
    const rows = await this.db
      .select()
      .from(t.predictions)
      .where(o.unresolved ? isNull(t.predictions.checkedAt) : undefined)
      .orderBy(desc(t.predictions.createdAt));
    return rows.map((r) => ({ ...r, metric: r.metric as PredictionMetric, predicted: r.predicted as Record<string, unknown> }));
  }

  /** Records what really happened (e.g. "B" won the real A/B test, or "price" was the top objection in sales calls). */
  async record(id: string, actual: string): Promise<StoredPrediction> {
    const [row] = await this.db.select().from(t.predictions).where(eq(t.predictions.id, id));
    if (!row) throw new Error(`No prediction ${id}`);
    const correct = isCorrect(row.metric, row.predicted as Record<string, unknown>, actual);
    const [updated] = await this.db
      .update(t.predictions)
      .set({ actual, correct, checkedAt: new Date() })
      .where(eq(t.predictions.id, id))
      .returning();
    return { ...updated, metric: updated.metric as PredictionMetric, predicted: updated.predicted as Record<string, unknown> };
  }

  async accuracy(): Promise<{ scored: number; correct: number; rate: number | null }> {
    const scored = await this.db.select({ correct: t.predictions.correct }).from(t.predictions).where(and(isNotNull(t.predictions.correct)));
    const correct = scored.filter((r) => r.correct).length;
    return { scored: scored.length, correct, rate: scored.length ? correct / scored.length : null };
  }
}
