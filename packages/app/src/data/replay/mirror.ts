// A minimal rrweb DOM on the server. It loads a full snapshot, then applies the
// incremental events after it by node id, as the rrweb replayer does: in each
// mutation the removes first, then the adds, the texts, and the attributes; an
// input event sets the value of its node. It knows nothing of layout or
// styles. It is enough to read the page at an instant and to name the element
// of a click or an input.

/** A node as rrweb serializes it. */
type SnapNode = {
  type: number;
  id?: number;
  tagName?: string;
  attributes?: Record<string, unknown>;
  textContent?: string;
  childNodes?: SnapNode[];
};

type Mutation = {
  removes?: { parentId: number; id: number }[];
  adds?: { parentId: number; nextId: number | null; node: SnapNode }[];
  texts?: { id: number; value: string | null }[];
  attributes?: { id: number; attributes: Record<string, unknown> }[];
};

// rrweb NodeType and IncrementalSource values that the mirror reads.
const DOCUMENT = 0;
const DOCTYPE = 1;
const ELEMENT = 2;
const TEXT = 3;
const COMMENT = 5;
const FULL_SNAPSHOT = 2;
const INCREMENTAL = 3;
const MUTATION = 0;
const INPUT = 5;

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
// Left out of the compact form: they hold no content a reader of the page sees.
const COMPACT_SKIP = new Set(["head", "script", "style", "noscript", "template", "link", "meta"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function isSnapNode(value: unknown): value is SnapNode {
  return !!value && typeof value === "object" && "type" in value && typeof value.type === "number";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// rrweb's own attributes (rr_width, rr_mediaState, _cssText, ...) are replay
// hints, not page attributes.
const rrwebAttribute = (name: string) => name.startsWith("rr_") || name.startsWith("_");

/** Applies an rrweb style diff ({ prop: value | [value, priority] | false }) to a style string. */
function patchStyle(style: string, diff: Record<string, unknown>): string {
  const props = new Map<string, string>();
  for (const decl of style.split(";")) {
    const at = decl.indexOf(":");
    if (at > 0) props.set(decl.slice(0, at).trim(), decl.slice(at + 1).trim());
  }
  for (const [prop, value] of Object.entries(diff)) {
    if (value === false) props.delete(prop);
    else if (typeof value === "string") props.set(prop, value);
    else if (Array.isArray(value) && typeof value[0] === "string")
      props.set(prop, value[1] ? `${value[0]} !${value[1]}` : value[0]);
  }
  return [...props].map(([prop, value]) => `${prop}: ${value}`).join("; ");
}

export function createMirror() {
  const nodes = new Map<number, SnapNode>();
  const parents = new Map<number, SnapNode>();
  let root: SnapNode | undefined;
  // True once an event referred to a node the mirror did not have.
  let lost = false;

  const index = (node: SnapNode, parent?: SnapNode) => {
    if (typeof node.id === "number") {
      nodes.set(node.id, node);
      if (parent) parents.set(node.id, parent);
    }
    for (const child of node.childNodes ?? []) index(child, node);
  };
  const forget = (node: SnapNode) => {
    if (typeof node.id === "number") {
      nodes.delete(node.id);
      parents.delete(node.id);
    }
    for (const child of node.childNodes ?? []) forget(child);
  };

  const mutate = (m: Mutation) => {
    for (const { parentId, id } of m.removes ?? []) {
      const node = nodes.get(id);
      const parent = nodes.get(parentId) ?? (node ? parents.get(id) : undefined);
      if (!node || !parent?.childNodes) {
        lost = true;
        continue;
      }
      parent.childNodes = parent.childNodes.filter((child) => child !== node);
      forget(node);
    }
    // An add can name a parent or a next sibling that a later add in the same
    // event creates. Retry until a pass makes no progress, as rrweb does.
    let pending = [...(m.adds ?? [])];
    while (pending.length) {
      const left: typeof pending = [];
      for (const add of pending) {
        const parent = nodes.get(add.parentId);
        const next = add.nextId === null ? undefined : nodes.get(add.nextId);
        if (!parent || (add.nextId !== null && !next)) {
          left.push(add);
          continue;
        }
        // A node that is already in the tree moves.
        const movedId = add.node.id;
        const existing = typeof movedId === "number" ? nodes.get(movedId) : undefined;
        if (existing && typeof movedId === "number") {
          const from = parents.get(movedId);
          if (from?.childNodes) from.childNodes = from.childNodes.filter((c) => c !== existing);
          forget(existing);
        }
        const node: SnapNode = { ...add.node, childNodes: [...(add.node.childNodes ?? [])] };
        const children = (parent.childNodes ??= []);
        const at = next ? children.indexOf(next) : -1;
        if (at >= 0) children.splice(at, 0, node);
        else children.push(node);
        index(node, parent);
      }
      if (left.length === pending.length) {
        lost = true;
        break;
      }
      pending = left;
    }
    for (const { id, value } of m.texts ?? []) {
      const node = nodes.get(id);
      if (node) node.textContent = value ?? "";
      else lost = true;
    }
    for (const { id, attributes } of m.attributes ?? []) {
      const node = nodes.get(id);
      if (!node) {
        lost = true;
        continue;
      }
      const attrs = (node.attributes ??= {});
      for (const [name, value] of Object.entries(attributes)) {
        if (value === null) delete attrs[name];
        else if (name === "style" && isRecord(value))
          attrs.style = patchStyle(typeof attrs.style === "string" ? attrs.style : "", value);
        else attrs[name] = value;
      }
    }
  };

  /** Applies one rrweb event. A full snapshot starts the mirror over. */
  const apply = (event: { type: number; data: Record<string, unknown> }) => {
    if (event.type === FULL_SNAPSHOT && isSnapNode(event.data.node)) {
      nodes.clear();
      parents.clear();
      lost = false;
      // The events are parsed for this read only, so the mirror owns them.
      root = event.data.node;
      index(root);
      return;
    }
    if (!root || event.type !== INCREMENTAL) return;
    const { data } = event;
    // oxlint-disable-next-line typescript/consistent-type-assertions -- rrweb types data per source; source 0 is a mutation, and mutate() checks each node it names.
    if (data.source === MUTATION) mutate(data as Mutation);
    else if (data.source === INPUT && typeof data.id === "number") {
      const node = nodes.get(data.id);
      if (!node) {
        lost = true;
        return;
      }
      const attrs = (node.attributes ??= {});
      if (typeof data.text === "string") attrs.value = data.text;
      if (typeof data.isChecked === "boolean") {
        if (data.isChecked) attrs.checked = "";
        else delete attrs.checked;
      }
    }
  };

  const textOf = (node: SnapNode): string =>
    node.type === TEXT ? (node.textContent ?? "") : (node.childNodes ?? []).map(textOf).join(" ");

  /**
   * A short name for the element of a node: its tag, id, test id, role or
   * name, and the start of its text when the text is not masked. Null when the
   * mirror does not have the node.
   */
  const describe = (id: number): string | null => {
    let node = nodes.get(id);
    if (node?.type === TEXT) node = parents.get(id);
    if (!node || node.type !== ELEMENT) return null;
    const attrs = node.attributes ?? {};
    const str = (name: string) => (typeof attrs[name] === "string" ? attrs[name] : "");
    let label = (node.tagName ?? "element").toLowerCase();
    if (str("id")) label += `#${str("id")}`;
    for (const name of ["data-testid", "name", "role", "type", "aria-label"]) {
      if (str(name) && !/^\**$/.test(str(name))) label += `[${name}="${str(name)}"]`;
    }
    const text = textOf(node).replace(/\s+/g, " ").trim();
    // Masked text is all asterisks: it names nothing.
    if (text && /[^*\s]/.test(text))
      label += ` "${text.length > 40 ? `${text.slice(0, 40)}…` : text}"`;
    return label;
  };

  const serialize = (node: SnapNode, compact: boolean, rawText: boolean): string => {
    if (node.type === TEXT) {
      const text = node.textContent ?? "";
      if (rawText) return text;
      return escapeHtml(compact ? text.replace(/\s+/g, " ") : text);
    }
    if (node.type === COMMENT) return compact ? "" : `<!--${escapeHtml(node.textContent ?? "")}-->`;
    if (node.type === DOCTYPE) return compact ? "" : `<!DOCTYPE ${node.tagName ?? "html"}>`;
    const children = (raw: boolean) =>
      (node.childNodes ?? []).map((child) => serialize(child, compact, raw)).join("");
    if (node.type === DOCUMENT) return children(false);
    if (node.type !== ELEMENT) return "";
    const tag = (node.tagName ?? "div").toLowerCase();
    if (compact && COMPACT_SKIP.has(tag)) return "";
    if (compact && tag === "html") return children(false);
    const attrs = Object.entries(node.attributes ?? {})
      .filter(([name]) => !rrwebAttribute(name) && !(compact && name === "style"))
      .map(([name, value]) => ` ${name}="${escapeHtml(String(value))}"`)
      .join("");
    // An <svg> is drawing, not content: the compact form keeps the element only.
    if (compact && tag === "svg") return `<svg${attrs}></svg>`;
    if (VOID_TAGS.has(tag)) return `<${tag}${attrs}>`;
    return `<${tag}${attrs}>${children(tag === "style" || tag === "script")}</${tag}>`;
  };

  /**
   * The page as HTML. The compact form keeps the body only, without scripts,
   * styles, inline style attributes, or drawing: what the page shows and how
   * it is built, for a reader with a small budget.
   */
  const html = (compact = false): string => {
    if (!root) return "";
    const out = serialize(root, compact, false);
    if (compact) return out.trim();
    return out.startsWith("<!DOCTYPE") || out.startsWith("<html") ? out : `<!doctype html>${out}`;
  };

  return {
    apply,
    describe,
    html,
    /** True when a snapshot is loaded. */
    loaded: () => !!root,
    /** True when an event since the snapshot named a node the mirror did not have. */
    lost: () => lost,
  };
}
