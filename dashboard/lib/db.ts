// The dashboard's connection to the run store. DATABASE_URL is the same Postgres the engine
// writes with --store (e.g. Neon); `pglite:<folder>` opens a local, file-backed one for
// development. The engine migrates the schema; the dashboard only reads.
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Db } from "../../src/store/db";
import * as schema from "../../src/store/schema";
import { postgresUrl } from "../../src/store/url";

const cache = globalThis as typeof globalThis & { __debutlyDb?: Db; __debutlySchemaReady?: boolean };

export function dbConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

export function getDb(): Db {
  if (cache.__debutlyDb) return cache.__debutlyDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = url.startsWith("pglite:")
    ? (drizzlePglite(new PGlite(url.slice("pglite:".length)), { schema }) as unknown as Db)
    : // One connection per serverless instance is plenty, and Neon's pooler prefers it.
      (drizzlePostgres(postgres(postgresUrl(url), { max: 1, prepare: false, onnotice: () => {} }), { schema }) as unknown as Db);
  cache.__debutlyDb = db;
  return db;
}

/**
 * False until the engine records its first run into this database, which creates the tables.
 * Until then the dashboard says there are no runs instead of failing.
 */
export async function schemaReady(): Promise<boolean> {
  if (cache.__debutlySchemaReady) return true;
  try {
    await getDb().select({ id: schema.runs.id }).from(schema.runs).limit(1);
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    if ((e.code ?? e.cause?.code) === "42P01") return false; // undefined_table
    throw err;
  }
  cache.__debutlySchemaReady = true;
  return true;
}
