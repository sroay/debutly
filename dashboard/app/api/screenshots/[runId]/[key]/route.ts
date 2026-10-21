import { DbArtifactStore } from "../../../../../../src/artifacts/db";
import { dbConfigured, getDb } from "../../../../../lib/db";

export const dynamic = "force-dynamic";

/** A step's screenshot kept in the database (the proxy has already checked the sign-in). */
export async function GET(_request: Request, ctx: { params: Promise<{ runId: string; key: string }> }) {
  const { runId, key } = await ctx.params;
  if (!dbConfigured() || !/^[0-9a-f-]{36}$/i.test(runId) || !/^[\w.-]+\.(jpg|png)$/.test(key)) {
    return new Response("Not found", { status: 404 });
  }
  const shot = await DbArtifactStore.get(getDb(), runId, key);
  if (!shot) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(shot.data), {
    headers: {
      "Content-Type": shot.contentType,
      // A run's screenshots never change; the browser may keep them.
      "Cache-Control": "private, max-age=604800, immutable",
    },
  });
}
