import { and, eq, lt } from "drizzle-orm";
import type { Db } from "../store/db";
import { screenshots } from "../store/schema";
import type { ArtifactStore, ScreenshotFormat } from "./store";

/** What a step's screenshot reference looks like when the image is in the database. */
export const DB_SCREENSHOT_PREFIX = "db:";

/**
 * Screenshots in the run's own Postgres, for deployments with no object storage: a free
 * Postgres (Neon's 0.5 GB) is all the dashboard needs. Compact JPEGs, and prune() drops old ones.
 */
export class DbArtifactStore implements ArtifactStore {
  readonly screenshotFormat: ScreenshotFormat = { type: "jpeg", quality: 50 };

  constructor(
    private readonly db: Db,
    private readonly runId: string,
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.db.insert(screenshots).values({ runId: this.runId, key, contentType, data: body }).onConflictDoNothing();
    return `${DB_SCREENSHOT_PREFIX}${this.runId}/${key}`;
  }

  /** Delete screenshots older than `days`: steps keep their text, the pictures go. */
  static async prune(db: Db, days: number, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const deleted = await db.delete(screenshots).where(lt(screenshots.createdAt, cutoff)).returning({ key: screenshots.key });
    return deleted.length;
  }

  static async get(db: Db, runId: string, key: string): Promise<{ contentType: string; data: Buffer } | null> {
    const [row] = await db
      .select({ contentType: screenshots.contentType, data: screenshots.data })
      .from(screenshots)
      .where(and(eq(screenshots.runId, runId), eq(screenshots.key, key)));
    return row ?? null;
  }
}

/** Every screenshot to each store (e.g. the CI artifact folder and the database); the last one's reference is kept. */
export class TeeArtifactStore implements ArtifactStore {
  readonly screenshotFormat?: ScreenshotFormat;

  constructor(private readonly stores: ArtifactStore[]) {
    this.screenshotFormat = stores.find((s) => s.screenshotFormat)?.screenshotFormat;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    let ref = "";
    for (const store of this.stores) ref = await store.put(key, body, contentType);
    return ref;
  }
}
