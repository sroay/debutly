import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { LocalArtifactStore } from "../../src/artifacts/store";
import { S3ArtifactStore } from "../../src/artifacts/s3";

it("writes artifacts into a local folder and returns their path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "debutly-artifacts-"));
  const store = new LocalArtifactStore(dir);
  const where = await store.put("p1-000.png", Buffer.from("png"), "image/png");
  expect(where).toBe(join(dir, "p1-000.png"));
  expect(await readFile(where, "utf8")).toBe("png");
});

it("uploads to an S3 bucket under the run's prefix and returns a URL", async () => {
  const send = vi.fn(async () => ({}));
  const store = new S3ArtifactStore({ bucket: "debutly", prefix: "run-1", publicBaseUrl: "http://localhost:9000/debutly", client: { send } });
  expect(await store.put("p1-000.png", Buffer.from("png"), "image/png")).toBe("http://localhost:9000/debutly/run-1/p1-000.png");
  const [command] = send.mock.calls[0] as unknown as [{ input: Record<string, unknown> }];
  expect(command.input).toMatchObject({ Bucket: "debutly", Key: "run-1/p1-000.png", ContentType: "image/png" });
});

it.runIf(process.env.S3_TEST_ENDPOINT)("round-trips through a real S3-compatible store (MinIO)", async () => {
  const store = S3ArtifactStore.fromEnv({ ...process.env, DEBUTLY_S3_ENDPOINT: process.env.S3_TEST_ENDPOINT }, "test-run");
  const url = await store!.put("hello.txt", Buffer.from("hi"), "text/plain");
  expect(url).toContain("test-run/hello.txt");
});
