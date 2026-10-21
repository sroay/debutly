import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";
import { postgresUrl } from "./url";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

export interface OpenDb {
  db: Db;
  close: () => Promise<void>;
}

/**
 * A Postgres connection with the schema migrated. `memory:` gives an in-process
 * PGlite database (tests, one-off local runs), `pglite:<folder>` one kept in a folder (local
 * dashboard work without a server); anything else is a postgres:// URL.
 */
export async function openDb(url: string): Promise<OpenDb> {
  if (url === "memory:" || url.startsWith("pglite:")) {
    const folder = url === "memory:" ? undefined : url.slice("pglite:".length);
    if (folder) mkdirSync(folder, { recursive: true });
    const client = folder ? new PGlite(folder) : new PGlite();
    const db = drizzlePglite(client, { schema });
    await migratePglite(db, { migrationsFolder: MIGRATIONS });
    return { db: db as unknown as Db, close: () => client.close() };
  }
  const client = postgres(postgresUrl(url), { max: 10, onnotice: () => {} });
  const db = drizzlePostgres(client, { schema });
  await migratePostgres(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Db, close: () => client.end() };
}
