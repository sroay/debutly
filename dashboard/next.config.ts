import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const config: NextConfig = {
  // The dashboard reads the engine's own schema and helpers from ../src: compile from the repo root.
  turbopack: { root: fileURLToPath(new URL("..", import.meta.url)) },
  outputFileTracingRoot: fileURLToPath(new URL("..", import.meta.url)),
  // PGlite (local, file-backed Postgres) ships WebAssembly: load it from node_modules as it is.
  serverExternalPackages: ["@electric-sql/pglite"],
  poweredByHeader: false,
};

export default config;
