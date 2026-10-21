import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ArtifactStore } from "./store";

export interface S3ArtifactOptions {
  bucket: string;
  /** Usually the run id, so each run's artifacts sit together. */
  prefix: string;
  /** Base URL the bucket is served at, for links in reports (e.g. MinIO's http://localhost:9000/<bucket>). */
  publicBaseUrl: string;
  client: Pick<S3Client, "send">;
}

/** Any S3-compatible store: MinIO in the self-hosted stack, S3/R2/etc. in production. */
export class S3ArtifactStore implements ArtifactStore {
  constructor(private readonly o: S3ArtifactOptions) {}

  /** From DEBUTLY_S3_ENDPOINT, DEBUTLY_S3_BUCKET, DEBUTLY_S3_ACCESS_KEY, DEBUTLY_S3_SECRET_KEY (and optional DEBUTLY_S3_REGION, DEBUTLY_S3_PUBLIC_URL); undefined if unset. */
  static fromEnv(env: Record<string, string | undefined>, prefix: string): S3ArtifactStore | undefined {
    const endpoint = env.DEBUTLY_S3_ENDPOINT;
    if (!endpoint) return undefined;
    const bucket = env.DEBUTLY_S3_BUCKET ?? "debutly";
    const client = new S3Client({
      endpoint,
      region: env.DEBUTLY_S3_REGION ?? "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: env.DEBUTLY_S3_ACCESS_KEY ?? "", secretAccessKey: env.DEBUTLY_S3_SECRET_KEY ?? "" },
    });
    return new S3ArtifactStore({ bucket, prefix, publicBaseUrl: env.DEBUTLY_S3_PUBLIC_URL ?? `${endpoint.replace(/\/+$/, "")}/${bucket}`, client });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    const fullKey = `${this.o.prefix}/${key}`;
    await this.o.client.send(new PutObjectCommand({ Bucket: this.o.bucket, Key: fullKey, Body: body, ContentType: contentType }));
    return `${this.o.publicBaseUrl.replace(/\/+$/, "")}/${fullKey}`;
  }
}
