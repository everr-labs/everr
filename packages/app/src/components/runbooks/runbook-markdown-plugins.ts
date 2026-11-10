import GithubSlugger from "github-slugger";

/** The parts of a markdown (mdast) node these plugins read and write. */
interface MdNode {
  type: string;
  value?: string;
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

/** Gives every heading GitHub's anchor id, numbered when a title repeats. */
export function remarkHeadingIds() {
  return (tree: MdNode) => {
    const slugger = new GithubSlugger();
    walk(tree, (node) => {
      if (node.type === "heading") setProperties(node, { id: slugger.slug(textOf(node)) });
    });
  };
}

export const CALLOUT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];
const CALLOUT_MARKER = new RegExp(`^\\[!(${CALLOUT_KINDS.join("|")})\\][ \\t]*(?:\\n|$)`, "i");

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

// Raw HTML is never rendered, except these tags, bare: they carry no
// attributes (`<details open>` aside), so they can't run script or load
// anything.
const ALLOWED_TAG = /<(\/?)(details|summary|kbd|mark|sub|sup)(\s+open)?\s*>/gi;

interface Tag {
  tag: string;
  close: boolean;
  open: boolean;
  raw: string;
}
type HtmlPiece = MdNode | Tag;

/** An html node's allowed tags and the text between them. Anything else in
 * it, other tags included, stays text, which React escapes. */
function splitHtml(value: string): HtmlPiece[] {
  const pieces: HtmlPiece[] = [];
  const pushText = (text: string) => {
    if (text.trim()) pieces.push({ type: "text", value: text });
  };
  let last = 0;
  for (const match of value.matchAll(ALLOWED_TAG)) {
    pushText(value.slice(last, match.index));
    pieces.push({
      tag: (match[2] ?? "").toLowerCase(),
      close: match[1] === "/",
      open: Boolean(match[3]),
      raw: match[0],
    });
    last = (match.index ?? 0) + match[0].length;
  }
  pushText(value.slice(last));
  return pieces;
}

/** Pairs each opening tag with its closing one among `pieces`, wrapping what
 * lies between; an unpaired tag stays as written. */
function pairTags(pieces: HtmlPiece[]): MdNode[] {
  const out: MdNode[] = [];
  const stack: (Tag & { at: number })[] = [];
  for (const piece of pieces) {
    if (!("tag" in piece)) {
      out.push(piece);
    } else if (!piece.close) {
      stack.push({ ...piece, at: out.length });
      out.push({ type: "text", value: piece.raw });
    } else {
      const opener = stack.map((entry) => entry.tag).lastIndexOf(piece.tag);
      const [start] = opener === -1 ? [] : stack.splice(opener);
      if (!start) {
        out.push({ type: "text", value: piece.raw });
        continue;
      }
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
      const pieces = node.children.flatMap((child): HtmlPiece[] =>
        child.type === "html" ? splitHtml(child.value ?? "") : [child],
      );
      node.children = pairTags(pieces);
    };
    visit(tree);
  };
}
