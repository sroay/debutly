import type { CDPSession, Page } from "playwright";
import type { AccessibleName } from "../types";

// The name and role Chromium gives assistive technology for each element Debutly tagged, read
// from its accessibility tree. Debutly's own reading of names (scan-script) is close but not the
// same: an icon button named by its SVG <title> has a name here and none there, and a control
// hidden with aria-hidden is listed there but hidden here. Chromium only; undefined elsewhere.

interface AXNode {
  ignored: boolean;
  ignoredReasons?: { name: string }[];
  role?: { value?: string };
  name?: { value?: string };
  backendDOMNodeId?: number;
}

interface DOMNode {
  backendNodeId: number;
  attributes?: string[];
  children?: DOMNode[];
  shadowRoots?: DOMNode[];
  contentDocument?: DOMNode;
}

const sessions = new WeakMap<Page, Promise<CDPSession | undefined>>();

function cdpFor(page: Page): Promise<CDPSession | undefined> {
  let session = sessions.get(page);
  if (!session) {
    session = page
      .context()
      .newCDPSession(page)
      .then(async (s) => {
        await s.send("Accessibility.enable");
        return s;
      })
      .catch(() => undefined);
    sessions.set(page, session);
  }
  return session;
}

/** Debutly id → what assistive technology is told about that element. */
export async function accessibleNames(page: Page): Promise<Map<number, AccessibleName> | undefined> {
  const cdp = await cdpFor(page);
  if (!cdp) return undefined;
  try {
    const [{ nodes }, { root }] = await Promise.all([
      cdp.send("Accessibility.getFullAXTree") as Promise<{ nodes: AXNode[] }>,
      cdp.send("DOM.getDocument", { depth: -1, pierce: true }) as Promise<{ root: DOMNode }>,
    ]);
    const tagged = new Map<number, number>();
    const walk = (n: DOMNode) => {
      const attrs = n.attributes ?? [];
      for (let i = 0; i < attrs.length; i += 2) if (attrs[i] === "data-debutly-id") tagged.set(n.backendNodeId, Number(attrs[i + 1]));
      for (const child of [...(n.children ?? []), ...(n.shadowRoots ?? []), ...(n.contentDocument ? [n.contentDocument] : [])]) walk(child);
    };
    walk(root);
    const out = new Map<number, AccessibleName>();
    for (const node of nodes) {
      const id = node.backendDOMNodeId === undefined ? undefined : tagged.get(node.backendDOMNodeId);
      if (id === undefined) continue;
      out.set(id, {
        name: (node.name?.value ?? "").replace(/\s+/g, " ").trim(),
        role: node.role?.value ?? "",
        hidden: node.ignored,
      });
    }
    return out;
  } catch {
    // A page navigating away mid-read, or a detached frame: this look goes without them.
    return undefined;
  }
}
