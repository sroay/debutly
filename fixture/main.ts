import { startFixture } from "./server";

const fx = await startFixture({ port: 4310 });
console.log(`Fixturely running at ${fx.url}`);
