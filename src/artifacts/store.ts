import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** How a store wants screenshots taken; PNG when it doesn't say. */
export interface ScreenshotFormat {
  type: "jpeg";
  quality: number;
}

/** Where step artifacts (screenshots) go. Returns a path or URL the report can show. */
export interface ArtifactStore {
  put(key: string, body: Buffer, contentType: string): Promise<string>;
  readonly screenshotFormat?: ScreenshotFormat;
}

/** A local folder: what file-only CLI runs (and CI) have always used. */
export class LocalArtifactStore implements ArtifactStore {
  constructor(private readonly dir: string) {}

  async put(key: string, body: Buffer, _contentType?: string): Promise<string> {
    const path = join(this.dir, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return path;
  }
}
