export type ProfileFrame = {
  name: string;
  file: string;
  /** 0 when unknown. */
  line: number;
};

/** One distinct call stack with its summed sample weight. Frames are root first. */
export type ProfileStack = {
  frames: ProfileFrame[];
  value: number;
  /** Index into `ProfileStacks.sources`: the code revision the samples came from. */
  source?: number;
};

/** The per-frame arrays as the `profiles` table stores them: leaf first. */
export type ProfileStackRow = {
  functionNames: string[];
  fileNames: string[];
  lineNumbers: number[];
  mappingFileNames: string[];
  /** Hex digits without the 0x prefix, as ClickHouse `hex()` returns them. */
  addresses: string[];
  value: string | number;
};

export function rowToStack(row: ProfileStackRow): ProfileStack {
  // Unsymbolized native frames have an address and a mapping but no function
  // name, so the function array alone can be shorter than the real stack.
  const depth = Math.max(
    row.functionNames.length,
    row.addresses.length,
    row.mappingFileNames.length,
  );
  const frames: ProfileFrame[] = [];
  for (let i = depth - 1; i >= 0; i--) {
    const mapping = row.mappingFileNames[i] ?? "";
    frames.push({
      name: row.functionNames[i] || hexAddress(row.addresses[i]) || mapping || "unknown",
      file: row.fileNames[i] || mapping,
      line: row.lineNumbers[i] ?? 0,
    });
  }
  return { frames, value: Number(row.value) };
}

function hexAddress(hex: string | undefined): string {
  const digits = (hex ?? "").replace(/^0+/, "").toLowerCase();
  return digits ? `0x${digits}` : "";
}

export type FlameNode = {
  /** Identifies the node among its siblings; frames merge on it. */
  key: string;
  name: string;
  file: string;
  /** 0 when unknown or when the merged frames disagree. */
  line: number;
  total: number;
  self: number;
  depth: number;
  /** Offset from the left edge of the root, in sample value units. */
  start: number;
  children: FlameNode[];
  parent: FlameNode | undefined;
};

export type FlameTree = {
  root: FlameNode;
  /** Depth of the deepest node; the root is depth 0. */
  maxDepth: number;
};

const ROOT_FRAME_NAME = "total";

export function frameKey(frame: ProfileFrame): string {
  return `${frame.name}\u0000${frame.file}`;
}

function createNode(key: string, frame: ProfileFrame, parent: FlameNode | undefined): FlameNode {
  return {
    key,
    name: frame.name,
    file: frame.file,
    line: frame.line,
    total: 0,
    self: 0,
    depth: parent ? parent.depth + 1 : 0,
    start: 0,
    children: [],
    parent,
  };
}

/** `rootFrame` names the root, for a tree of one function's callers or callees. */
export function buildFlameTree(
  stacks: readonly ProfileStack[],
  rootFrame: ProfileFrame = { name: ROOT_FRAME_NAME, file: "", line: 0 },
): FlameTree {
  const root = createNode("", rootFrame, undefined);
  const childIndex = new Map<FlameNode, Map<string, FlameNode>>();
  let maxDepth = 0;

  for (const stack of stacks) {
    if (stack.value <= 0) continue;
    root.total += stack.value;
    let node = root;
    for (const frame of stack.frames) {
      const key = frameKey(frame);
      let index = childIndex.get(node);
      if (!index) {
        index = new Map();
        childIndex.set(node, index);
      }
      let child = index.get(key);
      if (!child) {
        child = createNode(key, frame, node);
        index.set(key, child);
        node.children.push(child);
      } else if (child.line !== frame.line) {
        child.line = 0;
      }
      child.total += stack.value;
      node = child;
    }
    node.self += stack.value;
    maxDepth = Math.max(maxDepth, node.depth);
  }

  layout(root);
  return { root, maxDepth };
}

// Heaviest frames first, so the widest bars line up on the left at every level.
function layout(node: FlameNode) {
  node.children.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  let offset = node.start;
  for (const child of node.children) {
    child.start = offset;
    offset += child.total;
    layout(child);
  }
}

/** Sibling keys from the root down to `node`, stable across refetches of the same data. */
export function nodePath(node: FlameNode): string[] {
  const path: string[] = [];
  for (let current = node; current.parent; current = current.parent) path.push(current.key);
  return path.reverse();
}

/** The deepest node that still matches `path`, so a stale zoom falls back gracefully. */
export function findNodeByPath(root: FlameNode, path: readonly string[]): FlameNode {
  let node = root;
  for (const key of path) {
    const child = node.children.find((c) => c.key === key);
    if (!child) break;
    node = child;
  }
  return node;
}

/**
 * The stacks that pass through the frame at `path`, cut to start at that
 * frame, so their function stats describe only its subtree.
 */
export function stacksUnder(
  stacks: readonly ProfileStack[],
  path: readonly string[],
): readonly ProfileStack[] {
  if (path.length === 0) return stacks;
  return stacks.flatMap((stack) =>
    stack.frames.length >= path.length && path.every((key, i) => frameKey(stack.frames[i]) === key)
      ? [{ ...stack, frames: stack.frames.slice(path.length - 1) }]
      : [],
  );
}

export type FunctionStat = {
  key: string;
  name: string;
  file: string;
  /** 0 when unknown or when the stacks disagree. */
  line: number;
  self: number;
  total: number;
  /** The first stack's `source`, for a link to the code. */
  source?: number;
};

/**
 * Self and total per function across all stacks. A recursive function counts
 * once per stack in its total, so its total never exceeds the profile total.
 */
export function functionStats(stacks: readonly ProfileStack[]): FunctionStat[] {
  const stats = new Map<string, FunctionStat>();
  for (const stack of stacks) {
    if (stack.value <= 0) continue;
    const seen = new Set<string>();
    stack.frames.forEach((frame, i) => {
      const key = frameKey(frame);
      let stat = stats.get(key);
      if (!stat) {
        stat = {
          key,
          name: frame.name,
          file: frame.file,
          line: frame.line,
          self: 0,
          total: 0,
          ...(stack.source !== undefined ? { source: stack.source } : {}),
        };
        stats.set(key, stat);
      } else if (stat.line !== frame.line) {
        stat.line = 0;
      }
      if (!seen.has(key)) {
        seen.add(key);
        stat.total += stack.value;
      }
      if (i === stack.frames.length - 1) stat.self += stack.value;
    });
  }
  return [...stats.values()];
}
