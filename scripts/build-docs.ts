// Builds site/docs/*.html from the Markdown in site/docs-src. Run after editing the docs:
//   npx tsx scripts/build-docs.ts
// Both are committed: the site is static, so Vercel serves the built pages as they are.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Marked } from "marked";

const SRC = "site/docs-src";
const OUT = "site/docs";
const REPO = "https://github.com/sroay/debutly";

// The sidebar, in reading order. Each page's file in docs-src is <slug>.md.
const NAV: { section: string; pages: { slug: string; label: string }[] }[] = [
  {
    section: "Start",
    pages: [
      { slug: "index", label: "Overview" },
      { slug: "quick-start", label: "Quick start" },
      { slug: "configuration", label: "Configuration" },
      { slug: "github-actions", label: "GitHub Actions" },
    ],
  },
  {
    section: "Guides",
    pages: [
      { slug: "test-environments", label: "Test environments" },
      { slug: "data-and-privacy", label: "Data and privacy" },
      { slug: "reports", label: "Reading the report" },
      { slug: "teams", label: "Teams and invites" },
      { slug: "buyers", label: "What buyers think" },
      { slug: "dashboard", label: "The dashboard" },
      { slug: "models-and-costs", label: "Models and costs" },
    ],
  },
  { section: "Tutorials", pages: [{ slug: "tutorial-nextjs-supabase", label: "Next.js and Supabase" }] },
  { section: "Help", pages: [{ slug: "troubleshooting", label: "Troubleshooting" }] },
];

const pages = NAV.flatMap((s) => s.pages);
const hrefOf = (slug: string) => (slug === "index" ? "/docs" : `/docs/${slug}`);
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Front matter: `title:` and `description:` lines between --- fences. */
function parse(file: string): { title: string; description: string; body: string } {
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error(`${file}: no front matter`);
  const meta = Object.fromEntries(
    match[1].split("\n").map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim().replace(/^"(.*)"$/, "$1")]),
  );
  if (!meta.title || !meta.description) throw new Error(`${file}: front matter needs title and description`);
  return { title: meta.title, description: meta.description, body: text.slice(match[0].length) };
}

function render(markdown: string): string {
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      // Linkable headings: h2 and h3 get ids from their text.
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        if (depth === 1 || depth > 3) return `<h${depth}>${html}</h${depth}>\n`;
        const id = slugify(html);
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}">${html}</a></h${depth}>\n`;
      },
      // > **Never production.** … becomes a marked-off note.
      blockquote({ tokens }) {
        return `<aside class="callout">${this.parser.parse(tokens)}</aside>\n`;
      },
    },
  });
  // Wide tables scroll inside their own box on a phone, not the whole page.
  return (marked.parse(markdown, { async: false }) as string).replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");
}

function sidebar(current: string): string {
  return NAV.map(
    (s) =>
      `<h2 class="nav-section">${s.section}</h2>\n<ul>\n${s.pages
        .map((p) => `<li${p.slug === current ? ' class="here"' : ""}><a href="${hrefOf(p.slug)}"${p.slug === current ? ' aria-current="page"' : ""}>${p.label}</a></li>`)
        .join("\n")}\n</ul>`,
  ).join("\n");
}

function page(slug: string): string {
  const { title, description, body } = parse(join(SRC, `${slug}.md`));
  const at = pages.findIndex((p) => p.slug === slug);
  const prev = pages[at - 1];
  const next = pages[at + 1];
  const url = `https://debutly.dev${hrefOf(slug)}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(slug === "index" ? title : `${title} · Debutly docs`)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${url}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="https://debutly.dev/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#ECEEF0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Mono:wght@400;700&family=Atkinson+Hyperlegible+Next:wght@400;700&family=Big+Shoulders+Display:wght@800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/docs.css">
</head>
<body class="docs">
  <a class="skip" href="#content">Skip to content</a>

  <header class="top">
    <a class="wordmark" href="/" aria-label="Debutly home">
      <span class="mark" aria-hidden="true"></span>Debutly
    </a>
    <nav aria-label="Main">
      <a href="/docs" aria-current="${slug === "index" ? "page" : "false"}">Docs</a>
      <a href="${REPO}">GitHub</a>
    </nav>
  </header>

  <div class="docs-layout">
    <details class="docs-menu">
      <summary>Docs menu</summary>
      <nav aria-label="Docs">
${sidebar(slug)}
      </nav>
    </details>
    <nav class="docs-nav" aria-label="Docs">
${sidebar(slug)}
    </nav>

    <main id="content" class="docs-page">
      <article class="prose">
${render(body)}
      </article>
      <nav class="pager" aria-label="Previous and next page">
        ${prev ? `<a class="pager-prev" href="${hrefOf(prev.slug)}"><span>Previous</span>${prev.label}</a>` : "<span></span>"}
        ${next ? `<a class="pager-next" href="${hrefOf(next.slug)}"><span>Next</span>${next.label}</a>` : "<span></span>"}
      </nav>
      <p class="edit"><a href="${REPO}/edit/master/${SRC}/${slug}.md">Edit this page on GitHub</a></p>
    </main>
  </div>

  <footer class="foot">
    <p>Debutly is made by <a href="https://github.com/sroay">Chetan Sroay</a>.</p>
    <p class="foot-links"><a href="${REPO}">Source on GitHub</a> <a href="${REPO}/blob/master/LICENSE">AGPL-3.0 licence</a> <a href="${REPO}/security">Report a security issue</a></p>
  </footer>
</body>
</html>
`;
}

mkdirSync(OUT, { recursive: true });
for (const { slug } of pages) writeFileSync(join(OUT, `${slug}.html`), page(slug));
console.log(`Built ${pages.length} pages into ${OUT}/`);
