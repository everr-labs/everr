export interface FolderSummary {
  id: string;
  parentId: string | null;
  name: string;
}

export interface DashboardSummary {
  slug: string;
  name: string;
  folderId: string | null;
}

export interface FolderNode {
  folder: FolderSummary;
  subfolders: FolderNode[];
  dashboards: DashboardSummary[];
}

export interface DashboardTree {
  folders: FolderNode[];
  dashboards: DashboardSummary[];
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name);

export function buildTree(
  folders: FolderSummary[],
  dashboards: DashboardSummary[],
): DashboardTree {
  const folderIds = new Set(folders.map((f) => f.id));
  // Orphans (parent/folder id pointing at a non-existent folder) fall back to
  // root rather than disappearing.
  const resolveParent = (id: string | null) =>
    id !== null && folderIds.has(id) ? id : null;

  const childFolders = new Map<string | null, FolderSummary[]>();
  for (const folder of folders) {
    const parentId = resolveParent(folder.parentId);
    childFolders.set(parentId, [...(childFolders.get(parentId) ?? []), folder]);
  }

  const childDashboards = new Map<string | null, DashboardSummary[]>();
  for (const dashboard of dashboards) {
    const folderId = resolveParent(dashboard.folderId);
    childDashboards.set(folderId, [
      ...(childDashboards.get(folderId) ?? []),
      dashboard,
    ]);
  }

  const build = (parentId: string | null): FolderNode[] =>
    [...(childFolders.get(parentId) ?? [])].sort(byName).map((folder) => ({
      folder,
      subfolders: build(folder.id),
      dashboards: [...(childDashboards.get(folder.id) ?? [])].sort(byName),
    }));

  return {
    folders: build(null),
    dashboards: [...(childDashboards.get(null) ?? [])].sort(byName),
  };
}

export interface FlatFolder {
  folder: FolderSummary;
  depth: number;
}

export function flattenFolders(folders: FolderSummary[]): FlatFolder[] {
  const out: FlatFolder[] = [];
  const walk = (nodes: FolderNode[], depth: number) => {
    for (const node of nodes) {
      out.push({ folder: node.folder, depth });
      walk(node.subfolders, depth + 1);
    }
  };
  walk(buildTree(folders, []).folders, 0);
  return out;
}

export function descendantFolderIds(
  folders: FolderSummary[],
  folderId: string,
): Set<string> {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.parentId !== null) {
      children.set(folder.parentId, [
        ...(children.get(folder.parentId) ?? []),
        folder.id,
      ]);
    }
  }
  const result = new Set<string>([folderId]);
  const stack = [folderId];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    for (const childId of children.get(id) ?? []) {
      if (!result.has(childId)) {
        result.add(childId);
        stack.push(childId);
      }
    }
  }
  return result;
}

export function countFolderContents(
  folders: FolderSummary[],
  dashboards: DashboardSummary[],
  folderId: string,
): { folders: number; dashboards: number } {
  const ids = descendantFolderIds(folders, folderId);
  return {
    folders: ids.size - 1,
    dashboards: dashboards.filter(
      (d) => d.folderId !== null && ids.has(d.folderId),
    ).length,
  };
}

export function folderPath(
  folders: FolderSummary[],
  folderId: string | null,
): string {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const names: string[] = [];
  let current = folderId === null ? undefined : byId.get(folderId);
  while (current) {
    names.unshift(current.name);
    current =
      current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return names.join(" / ");
}

export interface SearchResults {
  folders: { folder: FolderSummary; path: string }[];
  dashboards: { dashboard: DashboardSummary; path: string }[];
}

export function searchItems(
  folders: FolderSummary[],
  dashboards: DashboardSummary[],
  query: string,
): SearchResults {
  const q = query.trim().toLowerCase();
  return {
    folders: folders
      .filter((f) => f.name.toLowerCase().includes(q))
      .sort(byName)
      .map((folder) => ({
        folder,
        path: folderPath(folders, folder.parentId),
      })),
    dashboards: dashboards
      .filter((d) => d.name.toLowerCase().includes(q))
      .sort(byName)
      .map((dashboard) => ({
        dashboard,
        path: folderPath(folders, dashboard.folderId),
      })),
  };
}
