import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { sampleFiles, sampleFor } from "../../src/browser/samples";

it("makes a real 1080 px PNG and a one-page PDF CV with text in it", async () => {
  const { photo, document } = await sampleFiles();
  const png = await readFile(photo);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(png.readUInt32BE(16)).toBe(1080); // IHDR width
  expect(png.readUInt32BE(20)).toBe(1080); // IHDR height
  const pdf = (await readFile(document)).toString("latin1");
  expect(pdf.startsWith("%PDF-1.4")).toBe(true);
  expect(pdf).toContain("(Alex Sample - Curriculum Vitae) '");
  // The cross-reference offsets point at each object, or readers reject the file.
  const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  expect(offsets).toHaveLength(5);
  offsets.forEach((o, i) => expect(pdf.slice(o).startsWith(`${i + 1} 0 obj\n`)).toBe(true));
});

it("picks the sample a field accepts", () => {
  expect(sampleFor("image/*")).toBe("photo");
  expect(sampleFor(".png,.jpg")).toBe("photo");
  expect(sampleFor("application/pdf")).toBe("document");
  expect(sampleFor(".pdf,.doc,.docx")).toBe("document");
  expect(sampleFor(null)).toBe("photo");
});
