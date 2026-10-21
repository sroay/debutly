import { afterEach, beforeEach, expect, it } from "vitest";
import { DbArtifactStore, TeeArtifactStore } from "../../src/artifacts/db";
import { LocalArtifactStore } from "../../src/artifacts/store";
import { openDb, type OpenDb } from "../../src/store/db";
import { PgRunStore } from "../../src/store/pg-run-store";
import { screenshots } from "../../src/store/schema";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let open: OpenDb;
let runId: string;
beforeEach(async () => {
  open = await openDb("memory:");
  runId = await new PgRunStore(open.db).createRun({ targetUrl: "http://app.test", goal: "g" });
});
afterEach(async () => {
  await open.close();
});

it("keeps screenshots in the database as JPEGs and reads them back by run and key", async () => {
  const store = new DbArtifactStore(open.db, runId);
  expect(store.screenshotFormat).toEqual({ type: "jpeg", quality: 50 });
  const ref = await store.put("u1-o-000.jpg", Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg");
  expect(ref).toBe(`db:${runId}/u1-o-000.jpg`);
  expect(await DbArtifactStore.get(open.db, runId, "u1-o-000.jpg")).toEqual({ contentType: "image/jpeg", data: Buffer.from([0xff, 0xd8, 0xff]) });
  expect(await DbArtifactStore.get(open.db, runId, "missing.jpg")).toBeNull();
});

it("prunes screenshots older than the retention, and keeps newer ones", async () => {
  const store = new DbArtifactStore(open.db, runId);
  await store.put("old.jpg", Buffer.from("a"), "image/jpeg");
  await open.db.update(screenshots).set({ createdAt: new Date(Date.now() - 8 * 86_400_000) });
  await store.put("new.jpg", Buffer.from("b"), "image/jpeg");
  expect(await DbArtifactStore.prune(open.db, 7)).toBe(1);
  expect(await DbArtifactStore.get(open.db, runId, "old.jpg")).toBeNull();
  expect(await DbArtifactStore.get(open.db, runId, "new.jpg")).not.toBeNull();
});

it("writes to every store in a tee, asks for the database's format, and returns the last reference", async () => {
  const dir = await mkdtemp(join(tmpdir(), "debutly-tee-"));
  const tee = new TeeArtifactStore([new LocalArtifactStore(dir), new DbArtifactStore(open.db, runId)]);
  expect(tee.screenshotFormat).toEqual({ type: "jpeg", quality: 50 });
  expect(await tee.put("p1-000.jpg", Buffer.from("jpg"), "image/jpeg")).toBe(`db:${runId}/p1-000.jpg`);
  expect(await readFile(join(dir, "p1-000.jpg"), "utf8")).toBe("jpg");
});
