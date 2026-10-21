import { expect, it } from "vitest";
import { postgresUrl } from "../../src/store/url";

it("drops Neon's channel_binding and keeps TLS", () => {
  expect(postgresUrl("postgresql://u:p@ep-x-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require")).toBe(
    "postgresql://u:p@ep-x-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require",
  );
  expect(postgresUrl("postgresql://u:p@h/db?channel_binding=require&sslmode=require")).toBe("postgresql://u:p@h/db?sslmode=require");
  expect(postgresUrl("postgresql://u:p@h/db?channel_binding=require")).toBe("postgresql://u:p@h/db");
});

it("leaves other URLs alone", () => {
  expect(postgresUrl("postgres://debutly:debutly@localhost:5433/debutly")).toBe("postgres://debutly:debutly@localhost:5433/debutly");
  expect(postgresUrl("postgres://u:p@h/db?sslmode=require")).toBe("postgres://u:p@h/db?sslmode=require");
});
