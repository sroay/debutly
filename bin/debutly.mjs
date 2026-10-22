#!/usr/bin/env node
// The `debutly` command. Debutly is TypeScript run through tsx, so there is no build step. Its
// own tsconfig is named, so the tsconfig of the app it runs in never changes how it compiles.
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

register({ tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)) });
await import("../src/bin.ts");
