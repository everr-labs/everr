import type { Dashboard } from "@/data/dashboards/schema";
import type { Notebook, NotebookPage, NotebookSpec } from "./schema";

export interface ResolvedPage {
  title: string;
  markdown: string;
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

/**
 * Adapt a notebook into a Dashboard-shaped document so the existing dashboard
 * machinery (DashboardProvider → useDashboardVariables → usePanelQueries →
 * VariableBar) works unchanged. `spec.panels` carries the notebook's shared
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
