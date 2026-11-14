import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT_MARKERS = [".git", "pnpm-workspace.yaml"];

/**
 * The nearest ancestor of `start` that looks like a repository root, so file
 * names in profiles match the paths a source host links to.
 */
export function findSourceRoot(start: string): string | undefined {
  let directory = resolve(start);
  for (;;) {
    if (ROOT_MARKERS.some((marker) => existsSync(join(directory, marker)))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}
