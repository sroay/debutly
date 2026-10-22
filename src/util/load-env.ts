// The debutly command reads a .env file in the folder it runs in, as `node --env-file=.env` does.
// Variables already set win. Imported first, before anything reads a setting.
import { existsSync } from "node:fs";

if (existsSync(".env") && typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
