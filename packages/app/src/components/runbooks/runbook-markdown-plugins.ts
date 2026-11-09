/** The parts of a markdown (mdast) node these plugins read and write. */
interface MdNode {
  type: string;
  value?: string;
  meta?: string | null;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

function walk(node: MdNode, visit: (node: MdNode) => void) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function setProperties(node: MdNode, properties: Record<string, unknown>) {
  node.data = { ...node.data, hProperties: { ...node.data?.hProperties, ...properties } };
}

function textOf(node: MdNode): string {
  return node.value ?? (node.children ?? []).map(textOf).join("");
}

/** A heading's anchor: GitHub's rule, lowercased words joined by hyphens. */
function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Gives every heading an id to link to, numbered when a title repeats. */
export function remarkHeadingIds() {
  return (tree: MdNode) => {
    const seen = new Map<string, number>();
    walk(tree, (node) => {
      if (node.type !== "heading") return;
      const slug = headingSlug(textOf(node)) || "section";
      const count = seen.get(slug) ?? 0;
      seen.set(slug, count + 1);
      setProperties(node, { id: count === 0 ? slug : `${slug}-${count}` });
    });
  };
}

export const CALLOUT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];
const CALLOUT_MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)/i;

/**
 * GitHub's alert syntax: a quote opening with `[!NOTE]`, `[!TIP]`,
 * `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]` renders as that callout.
 */
export function remarkCallouts() {
  return (tree: MdNode) => {
    walk(tree, (node) => {
      if (node.type !== "blockquote") return;
      const paragraph = node.children?.[0];
      const text = paragraph?.type === "paragraph" ? paragraph.children?.[0] : undefined;
      const match = text?.type === "text" ? CALLOUT_MARKER.exec(text.value ?? "") : null;
      if (!paragraph || !text || !match?.[1]) return;
      text.value = (text.value ?? "").slice(match[0].length);
      if (!text.value) paragraph.children?.shift();
      if (!paragraph.children?.length) node.children?.shift();
      setProperties(node, { dataCallout: match[1].toLowerCase() });
    });
  };
}

/** Passes a fence's info string after the language (`title="…" {2,4-6}`)
 * to the block, which reads its options from it. */
export function remarkCodeMeta() {
  return (tree: MdNode) => {
    walk(tree, (node) => {
      if (node.type === "code" && node.meta) setProperties(node, { dataMeta: node.meta });
    });
  };
}

/** Marks images inside links, which follow the link rather than open full size. */
export function remarkImagesInLinks() {
  return (tree: MdNode) => {
    walk(tree, (node) => {
      if (node.type !== "link") return;
      walk(node, (inner) => {
        if (inner.type === "image") setProperties(inner, { dataInLink: true });
      });
    });
  };
}

// Raw HTML is never rendered, except these tags, bare: they carry no
// attributes (`<details open>` aside), so they can't run script or load
// anything.
const ALLOWED_TAG = /<(\/?)(details|summary|kbd|mark|sub|sup)(\s+open)?\s*>/gi;

type HtmlPiece = MdNode | { tag: string; close: boolean; open: boolean; raw: string };

/** An html node's tags and the text between them, or null when it holds
 * anything but allowed tags. */
function splitHtml(value: string): HtmlPiece[] | null {
  const pieces: HtmlPiece[] = [];
  let last = 0;
  for (const match of value.matchAll(ALLOWED_TAG)) {
    const before = value.slice(last, match.index);
    if (/[<>]/.test(before)) return null;
    if (before.trim()) pieces.push({ type: "text", value: before });
    pieces.push({
      tag: (match[2] ?? "").toLowerCase(),
      close: match[1] === "/",
      open: Boolean(match[3]),
      raw: match[0],
    });
    last = (match.index ?? 0) + match[0].length;
  }
  const rest = value.slice(last);
  if (/[<>]/.test(rest)) return null;
  if (rest.trim()) pieces.push({ type: "text", value: rest });
  return pieces;
}

/** Pairs each opening tag with its closing one among `pieces`, wrapping what
 * lies between; an unpaired tag stays as written. */
function pairTags(pieces: HtmlPiece[]): MdNode[] {
  const out: MdNode[] = [];
  const stack: { tag: string; open: boolean; raw: string; at: number }[] = [];
  for (const piece of pieces) {
    if (!("tag" in piece)) {
      out.push(piece);
      continue;
    }
    const opener = piece.close ? stack.map((entry) => entry.tag).lastIndexOf(piece.tag) : -1;
    if (!piece.close) {
      stack.push({ tag: piece.tag, open: piece.open, raw: piece.raw, at: out.length });
      out.push({ type: "text", value: piece.raw });
    } else if (opener === -1) {
      out.push({ type: "text", value: piece.raw });
    } else {
      const [start] = stack.splice(opener);
      if (!start) continue;
      const children = out.splice(start.at + 1);
      out.pop();
      out.push({
        type: start.tag === "details" || start.tag === "summary" ? "blockHtml" : "inlineHtml",
        children,
        data: { hName: start.tag, hProperties: start.open ? { open: true } : {} },
      });
    }
  }
  return out;
}

/** Renders the allowed raw HTML tags (see ALLOWED_TAG); any other HTML keeps
 * showing as the text it was written as. */
export function remarkAllowedHtml() {
  return (tree: MdNode) => {
    const visit = (node: MdNode) => {
      if (!node.children) return;
      for (const child of node.children) visit(child);
      if (!node.children.some((child) => child.type === "html")) return;
      const pieces = node.children.flatMap((child): HtmlPiece[] => {
        if (child.type !== "html") return [child];
        return splitHtml(child.value ?? "") ?? [child];
      });
      node.children = pairTags(pieces);
    };
    visit(tree);
  };
}
