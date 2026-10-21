import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { openDb } from "../../src/store/db";

it("migrates a fresh database to the run schema", async () => {
  const { db, close } = await openDb("memory:");
  try {
    const rows = await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`);
    const tables = (rows as unknown as { rows: { table_name: string }[] }).rows.map((r) => r.table_name);
    expect(tables).toEqual(expect.arrayContaining(["agents", "customer_units", "findings", "runs", "sessions", "side_effects", "steps"]));
  } finally {
    await close();
  }
});
