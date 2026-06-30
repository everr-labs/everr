export interface DashboardSummary {
  slug: string;
  project: string;
  name: string;
  folderPath: string;
  /** ISO timestamp of the row's updated_at; drives the "recently updated" sort. */
  updatedAt: string;
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

export type DashboardSort = "updated" | "name";

// ISO strings sort lexicographically in chronological order, so descending =
// (b, a). Ties fall back to the stable name ordering.
const byUpdated = (a: DashboardSummary, b: DashboardSummary) =>
  b.updatedAt.localeCompare(a.updatedAt) || dashboardOrder(a, b);

function comparatorFor(sort: DashboardSort) {
  return sort === "updated" ? byUpdated : dashboardOrder;
}

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

export function buildTree(
  dashboards: DashboardSummary[],
  sort: DashboardSort = "name",
): DashboardTree {
  const order = comparatorFor(sort);
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
    dashboards: [...node.dashboards].sort(order),
  });

  return {
    folders: [...root.children.values()]
      .map(freeze)
      .sort((a, b) => a.name.localeCompare(b.name)),
    dashboards: [...root.dashboards].sort(order),
  };
}

export interface SearchResults {
  dashboards: { dashboard: DashboardSummary; path: string }[];
}

export function searchItems(
  dashboards: DashboardSummary[],
  query: string,
  sort: DashboardSort = "name",
): SearchResults {
  const q = query.trim().toLowerCase();
  if (!q) return { dashboards: [] };
  return {
    dashboards: dashboards
      .filter((d) => d.name.toLowerCase().includes(q))
      .sort(comparatorFor(sort))
      .map((dashboard) => ({ dashboard, path: dashboard.folderPath })),
  };
}

function splitFolderPath(folderPath: string): string[] {
  return folderPath
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Walk the tree to the folder named by `folderPath` ("A / B"); null if absent. */
export function nodeAtPath(
  tree: DashboardTree,
  folderPath: string,
): FolderNode | null {
  const segments = splitFolderPath(folderPath);
  if (segments.length === 0) return null;
  let nodes = tree.folders;
  let found: FolderNode | null = null;
  for (const segment of segments) {
    found = nodes.find((n) => n.name === segment) ?? null;
    if (!found) return null;
    nodes = found.subfolders;
  }
  return found;
}

/** Cumulative breadcrumb segments for a folder path, root-first. */
export function breadcrumbSegments(
  folderPath: string,
): { name: string; path: string }[] {
  const acc: string[] = [];
  return splitFolderPath(folderPath).map((name) => {
    acc.push(name);
    return { name, path: acc.join(" / ") };
  });
}
