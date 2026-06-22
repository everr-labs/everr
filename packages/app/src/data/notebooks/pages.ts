import type { Dashboard } from "@/data/dashboards/schema";
import type { Notebook, NotebookPage, NotebookSpec } from "./schema";

export interface ResolvedPage {
  title: string;
  markdown: string;
  /** Original `markdown.file` path (post-CLI), if the page came from a file. */
  file?: string;
}

function pageTitle(page: NotebookPage): string {
  return page.display?.name ?? page.name;
}

/**
 * Resolve a page path ("" = index, "a/b" = nested) to its title and markdown.
 * Returns null when any segment doesn't match — the viewer shows page-not-found
 * inline (the notebook itself exists).
 */
export function findPage(
  spec: NotebookSpec,
  pagePath: string,
): ResolvedPage | null {
  const segments = pagePath.split("/").filter(Boolean);
  if (segments.length === 0) {
    return {
      title: spec.display?.name ?? "",
      markdown: spec.markdown.inline ?? "",
      ...(spec.markdown.file !== undefined ? { file: spec.markdown.file } : {}),
    };
  }
  let pages = spec.pages ?? [];
  let resolved: NotebookPage | null = null;
  for (const segment of segments) {
    const found = pages.find((p) => p.name === segment);
    if (!found) return null;
    resolved = found;
    pages = found.pages ?? [];
  }
  if (!resolved) return null;
  return {
    title: pageTitle(resolved),
    markdown: resolved.markdown.inline ?? "",
    ...(resolved.markdown.file !== undefined
      ? { file: resolved.markdown.file }
      : {}),
  };
}

export interface PageNavNode {
  /** Joined page-name path, e.g. "triage/network". */
  path: string;
  title: string;
  children: PageNavNode[];
}

export function pageNavTree(spec: NotebookSpec): PageNavNode[] {
  const build = (
    pages: NotebookPage[] | undefined,
    prefix: string,
  ): PageNavNode[] =>
    (pages ?? []).map((page) => {
      const path = prefix ? `${prefix}/${page.name}` : page.name;
      return {
        path,
        title: pageTitle(page),
        children: build(page.pages, path),
      };
    });
  return build(spec.pages, "");
}

/** Normalize a relative path: resolve "." and ".." segments, POSIX-style. */
function normalizePath(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else out.push("..");
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

/**
 * Map each page's source markdown file (normalized, relative to the notebook
 * YAML) to its page path. Pages authored with `inline:` only don't appear.
 * Includes the index page ("" path) when spec.markdown.file is present.
 */
export function buildFileToPageMap(spec: NotebookSpec): Map<string, string> {
  const map = new Map<string, string>();
  if (spec.markdown.file !== undefined) {
    map.set(normalizePath(spec.markdown.file), "");
  }
  const walk = (pages: NotebookPage[] | undefined, prefix: string): void => {
    for (const page of pages ?? []) {
      const path = prefix ? `${prefix}/${page.name}` : page.name;
      if (page.markdown.file !== undefined) {
        map.set(normalizePath(page.markdown.file), path);
      }
      walk(page.pages, path);
    }
  };
  walk(spec.pages, "");
  return map;
}

/** Strip a trailing slash and any "#fragment" or "?query" suffix. */
function stripHrefSuffix(href: string): string {
  let value = href;
  const hash = value.indexOf("#");
  if (hash !== -1) value = value.slice(0, hash);
  const query = value.indexOf("?");
  if (query !== -1) value = value.slice(0, query);
  return value.replace(/\/+$/, "");
}

/**
 * The "#fragment" of an href, without the leading "#", or undefined when there
 * is none. The resolver strips the fragment to match a page path, so the link
 * consumer re-applies it to the router <Link> (via its `hash` prop) — otherwise
 * `traffic.md#errors` would navigate to the top of the page, not the heading.
 * (Query strings are intentionally not carried: notebook routes have a typed
 * search schema, so arbitrary markdown query params aren't part of it.)
 */
export function hrefHash(href: string): string | undefined {
  const i = href.indexOf("#");
  if (i === -1) return undefined;
  return href.slice(i + 1) || undefined;
}

/** Resolve one markdown href against a notebook to a page path, or null. */
export type NotebookLinkResolver = (
  href: string,
  currentFile: string | undefined,
) => string | null;

/**
 * Build a resolver that maps a markdown href to a notebook page path, or null
 * when the link is external/unresolvable and should render as a plain anchor.
 * The spec-derived lookups (page-path set, file→page map) are computed once and
 * captured, so resolving many links on a page doesn't re-walk the tree per link.
 * Resolution order, per href:
 *  1. external schemes (http:, https:, mailto:), hash-only, and app-absolute
 *     ("/...") hrefs → null
 *  2. href (sans trailing slash and any "#fragment"/"?query" suffix) matches a
 *     page path in the nav tree (or "" for the index) → that page path
 *  3. href resolved relative to the directory of currentFile (the current
 *     page's markdown.file) matches an entry in buildFileToPageMap → that page
 *  4. otherwise null
 */
export function makeNotebookLinkResolver(
  spec: NotebookSpec,
): NotebookLinkResolver {
  const pagePaths = new Set<string>([""]);
  const collect = (nodes: PageNavNode[]): void => {
    for (const node of nodes) {
      pagePaths.add(node.path);
      collect(node.children);
    }
  };
  collect(pageNavTree(spec));
  const fileMap = buildFileToPageMap(spec);

  return (href, currentFile) => {
    // 1. external / absolute / hash-only links are not notebook navigation.
    if (
      href === "" ||
      href.startsWith("#") ||
      href.startsWith("/") ||
      /^[a-z][a-z0-9+.-]*:/i.test(href)
    ) {
      return null;
    }

    const target = stripHrefSuffix(href);

    // 2. direct page-path match against the nav tree (plus "" for the index).
    if (pagePaths.has(target)) return target;

    // 3. resolve relative to the current page's source file against the file map.
    if (currentFile !== undefined) {
      const dir = currentFile.includes("/")
        ? currentFile.slice(0, currentFile.lastIndexOf("/"))
        : "";
      const resolved = normalizePath(dir ? `${dir}/${target}` : target);
      const page = fileMap.get(resolved);
      if (page !== undefined) return page;
    }

    return null;
  };
}

/**
 * Convenience wrapper around {@link makeNotebookLinkResolver} for a single href
 * — builds a throwaway resolver, so prefer the factory when resolving many.
 */
export function resolveNotebookLink(
  href: string,
  currentFile: string | undefined,
  spec: NotebookSpec,
): string | null {
  return makeNotebookLinkResolver(spec)(href, currentFile);
}

/**
 * Adapt a notebook into a Dashboard-shaped document so the existing dashboard
 * machinery (DashboardProvider → useDashboardPanelData → VariableBar) works
 * unchanged. `spec.panels` carries the notebook's shared
 * panels so `ref:` embeds resolve through the same context.
 */
export function toDashboardDocument(
  notebook: Notebook,
  project: string,
  slug: string,
): Dashboard {
  const spec: Dashboard["spec"] = {
    display: notebook.spec.display,
    panels: notebook.spec.panels ?? {},
    layouts: [],
    duration: notebook.spec.duration,
    refreshInterval: notebook.spec.refreshInterval,
  };
  if (notebook.spec.variables !== undefined) {
    spec.variables = notebook.spec.variables;
  }
  return {
    kind: "Dashboard",
    metadata: { name: slug, project },
    spec,
  };
}
