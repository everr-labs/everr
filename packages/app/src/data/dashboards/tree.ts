import type { PreviewStatus } from "@/data/previews/overlay";

export interface DashboardSummary {
  slug: string;
  project: string;
  name: string;
  folderPath: string;
  /** Diff status when the list is viewed under an active preview. */
  previewStatus?: PreviewStatus;
}

export interface FolderNode {
  name: string;
  path: string;
  subfolders: FolderNode[];
  dashboards: DashboardSummary[];
}

export interface DashboardTree {
  folders: FolderNode[];
  dashboards: DashboardSummary[];
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name);

const dashboardOrder = (a: DashboardSummary, b: DashboardSummary) =>
  byName(a, b) ||
  a.slug.localeCompare(b.slug) ||
  a.project.localeCompare(b.project);

function splitPath(folderPath: string): string[] {
  return folderPath
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

interface MutableNode {
  name: string;
  path: string;
  children: Map<string, MutableNode>;
  dashboards: DashboardSummary[];
}

function emptyNode(name: string, path: string): MutableNode {
  return { name, path, children: new Map(), dashboards: [] };
}

export function buildTree(dashboards: DashboardSummary[]): DashboardTree {
  const root = emptyNode("", "");

  for (const dashboard of dashboards) {
    const segments = splitPath(dashboard.folderPath);
    let node = root;
    const acc: string[] = [];
    for (const segment of segments) {
      acc.push(segment);
      const path = acc.join(" / ");
      let child = node.children.get(segment);
      if (!child) {
        child = emptyNode(segment, path);
        node.children.set(segment, child);
      }
      node = child;
    }
    node.dashboards.push(dashboard);
  }

  const freeze = (node: MutableNode): FolderNode => ({
    name: node.name,
    path: node.path,
    subfolders: [...node.children.values()]
      .map(freeze)
      .sort((a, b) => a.name.localeCompare(b.name)),
    dashboards: [...node.dashboards].sort(dashboardOrder),
  });

  return {
    folders: [...root.children.values()]
      .map(freeze)
      .sort((a, b) => a.name.localeCompare(b.name)),
    dashboards: [...root.dashboards].sort(dashboardOrder),
  };
}

export interface SearchResults {
  dashboards: { dashboard: DashboardSummary; path: string }[];
}

export function searchItems(
  dashboards: DashboardSummary[],
  query: string,
): SearchResults {
  const q = query.trim().toLowerCase();
  if (!q) return { dashboards: [] };
  return {
    dashboards: dashboards
      .filter((d) => d.name.toLowerCase().includes(q))
      .sort(dashboardOrder)
      .map((dashboard) => ({ dashboard, path: dashboard.folderPath })),
  };
}
