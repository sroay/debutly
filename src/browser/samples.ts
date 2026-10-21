// Files an agent can attach where an app asks for one: a photo (for a post, an avatar, a logo)
// and a document (a CV, a brief). Made here rather than shipped, and made up: nothing real or
// personal is ever uploaded. Written once per process to the system's temp folder.
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

export type SampleKind = "photo" | "document";

/** A square photo, large enough for social posts that refuse small images (1080 px). */
const PHOTO_PX = 1080;

let written: Promise<Record<SampleKind, string>> | undefined;

/** Paths to the sample files, written on first use. */
export function sampleFiles(): Promise<Record<SampleKind, string>> {
  written ??= (async () => {
    const dir = join(tmpdir(), "debutly-samples");
    await mkdir(dir, { recursive: true });
    const photo = join(dir, "sample-photo.png");
    const document = join(dir, "sample-cv.pdf");
    await writeFile(photo, png(PHOTO_PX, PHOTO_PX));
    await writeFile(document, pdf(SAMPLE_CV));
    return { photo, document };
  })();
  return written;
}

/** Which sample an upload field wants, from its `accept` attribute; a photo when it doesn't say. */
export function sampleFor(accept: string | null | undefined): SampleKind {
  const a = (accept ?? "").toLowerCase();
  if (!a || /image|\.png|\.jpe?g|\.gif|\.webp/.test(a)) return "photo";
  if (/pdf|word|document|text|\.docx?|\.txt|\.rtf/.test(a)) return "document";
  return "photo";
}

const SAMPLE_CV = [
  "Alex Sample - Curriculum Vitae",
  "alex.sample@example.com - London, UK",
  "",
  "Experience",
  "Marketing Coordinator, Example Ltd (2022 - present)",
  "- Ran weekly social campaigns and reported on their results",
  "Marketing Assistant, Sample & Co (2020 - 2022)",
  "- Wrote newsletters and kept the company blog up to date",
  "",
  "Education",
  "BA Business Studies, Example University (2017 - 2020)",
  "",
  "Skills",
  "Copywriting, Social media, Google Analytics, Canva, Excel",
];

// A gradient, so image checks that refuse blank pictures accept it.
function png(width: number, height: number): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      row[1 + x * 3] = Math.round((x / width) * 200) + 30;
      row[2 + x * 3] = Math.round((y / height) * 160) + 60;
      row[3 + x * 3] = 170;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function crc32(bytes: Buffer): number {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

// A one-page PDF with real text, so apps that read a CV's text find some.
function pdf(lines: string[]): Buffer {
  const escape = (s: string) => s.replace(/[\\()]/g, (m) => `\\${m}`);
  const text = ["BT", "/F1 12 Tf", "16 TL", "56 780 Td", ...lines.map((l) => `(${escape(l)}) '`), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
