import { Button } from "@everr/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  EllipsisVertical,
  Folder,
  FolderInput,
  FolderPlus,
  LayoutDashboard,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  useDeleteDashboard,
  useDeleteFolder,
  useMoveDashboard,
  useMoveFolder,
  useRenameDashboard,
  useRenameFolder,
} from "@/data/dashboards/options";
import {
  buildTree,
  countFolderContents,
  type DashboardSummary,
  descendantFolderIds,
  type FolderNode,
  type FolderSummary,
  searchItems,
} from "@/data/dashboards/tree";
import { DeleteDashboardDialog } from "./delete-dashboard-dialog";
import { DeleteFolderDialog } from "./delete-folder-dialog";
import { FolderPickerDialog } from "./folder-picker";
import { NameDialog } from "./name-dialog";

type TreeAction =
  | { type: "create-subfolder"; folder: FolderSummary }
  | { type: "rename-folder"; folder: FolderSummary }
  | { type: "move-folder"; folder: FolderSummary }
  | { type: "delete-folder"; folder: FolderSummary }
  | { type: "rename-dashboard"; dashboard: DashboardSummary }
  | { type: "move-dashboard"; dashboard: DashboardSummary }
  | { type: "delete-dashboard"; dashboard: DashboardSummary };

interface DashboardTreeProps {
  folders: FolderSummary[];
  dashboards: DashboardSummary[];
  search: string;
  onCreateSubfolder: (parentId: string) => void;
}

export function DashboardTree({
  folders,
  dashboards,
  search,
  onCreateSubfolder,
}: DashboardTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<TreeAction | null>(null);

  const renameDashboard = useRenameDashboard();
  const moveDashboard = useMoveDashboard();
  const deleteDashboard = useDeleteDashboard();
  const renameFolder = useRenameFolder();
  const moveFolder = useMoveFolder();
  const deleteFolder = useDeleteFolder();

  const tree = useMemo(
    () => buildTree(folders, dashboards),
    [folders, dashboards],
  );

  const searching = search.trim().length > 0;
  const results = useMemo(
    () => (searching ? searchItems(folders, dashboards, search) : null),
    [searching, folders, dashboards, search],
  );

  const toggle = (folderId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const handleAction = (next: TreeAction) => {
    if (next.type === "create-subfolder") {
      onCreateSubfolder(next.folder.id);
      return;
    }
    setAction(next);
  };

  const closeAction = () => setAction(null);

  const deleteCounts =
    action?.type === "delete-folder"
      ? countFolderContents(folders, dashboards, action.folder.id)
      : null;

  return (
    <div className="flex flex-col">
      {results ? (
        <>
          {results.folders.map(({ folder, path }) => (
            <SearchFolderRow
              key={folder.id}
              folder={folder}
              path={path}
              onAction={handleAction}
            />
          ))}
          {results.dashboards.map(({ dashboard, path }) => (
            <DashboardRow
              key={dashboard.slug}
              dashboard={dashboard}
              depth={0}
              path={path}
              onAction={handleAction}
            />
          ))}
          {results.folders.length === 0 && results.dashboards.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No dashboards or folders match your search
            </p>
          )}
        </>
      ) : (
        <>
          {tree.folders.map((node) => (
            <FolderRows
              key={node.folder.id}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              onAction={handleAction}
            />
          ))}
          {tree.dashboards.map((dashboard) => (
            <DashboardRow
              key={dashboard.slug}
              dashboard={dashboard}
              depth={0}
              onAction={handleAction}
            />
          ))}
        </>
      )}

      <NameDialog
        open={action?.type === "rename-folder"}
        onOpenChange={(open) => {
          if (!open) closeAction();
        }}
        title="Rename folder"
        initialName={action?.type === "rename-folder" ? action.folder.name : ""}
        confirmLabel="Rename"
        isPending={renameFolder.isPending}
        onConfirm={(name) => {
          if (action?.type !== "rename-folder") return;
          renameFolder.mutate(
            { folderId: action.folder.id, name },
            { onSuccess: closeAction },
          );
        }}
      />

      <NameDialog
        open={action?.type === "rename-dashboard"}
        onOpenChange={(open) => {
          if (!open) closeAction();
        }}
        title="Rename dashboard"
        initialName={
          action?.type === "rename-dashboard" ? action.dashboard.name : ""
        }
        confirmLabel="Rename"
        isPending={renameDashboard.isPending}
        onConfirm={(name) => {
          if (action?.type !== "rename-dashboard") return;
          renameDashboard.mutate(
            { slug: action.dashboard.slug, name },
            { onSuccess: closeAction },
          );
        }}
      />

      <FolderPickerDialog
        open={action?.type === "move-folder"}
        onOpenChange={(open) => {
          if (!open) closeAction();
        }}
        title="Move folder"
        folders={folders}
        initialFolderId={
          action?.type === "move-folder" ? action.folder.parentId : null
        }
        disabledIds={
          action?.type === "move-folder"
            ? descendantFolderIds(folders, action.folder.id)
            : undefined
        }
        isPending={moveFolder.isPending}
        onConfirm={(parentId) => {
          if (action?.type !== "move-folder") return;
          moveFolder.mutate(
            { folderId: action.folder.id, parentId },
            { onSuccess: closeAction },
          );
        }}
      />

      <FolderPickerDialog
        open={action?.type === "move-dashboard"}
        onOpenChange={(open) => {
          if (!open) closeAction();
        }}
        title="Move dashboard"
        folders={folders}
        initialFolderId={
          action?.type === "move-dashboard" ? action.dashboard.folderId : null
        }
        isPending={moveDashboard.isPending}
        onConfirm={(folderId) => {
          if (action?.type !== "move-dashboard") return;
          moveDashboard.mutate(
            { slug: action.dashboard.slug, folderId },
            { onSuccess: closeAction },
          );
        }}
      />

      <DeleteDashboardDialog
        open={action?.type === "delete-dashboard"}
        onOpenChange={(open) => {
          if (!open) closeAction();
        }}
        name={action?.type === "delete-dashboard" ? action.dashboard.name : ""}
        isPending={deleteDashboard.isPending}
        onConfirm={() => {
          if (action?.type !== "delete-dashboard") return;
          deleteDashboard.mutate(action.dashboard.slug, {
            onSuccess: closeAction,
          });
        }}
      />

      <DeleteFolderDialog
        open={action?.type === "delete-folder"}
        onOpenChange={(open) => {
          if (!open) closeAction();
        }}
        name={action?.type === "delete-folder" ? action.folder.name : ""}
        dashboardCount={deleteCounts?.dashboards ?? 0}
        folderCount={deleteCounts?.folders ?? 0}
        isPending={deleteFolder.isPending}
        onConfirm={(mode) => {
          if (action?.type !== "delete-folder") return;
          deleteFolder.mutate(
            { folderId: action.folder.id, mode },
            { onSuccess: closeAction },
          );
        }}
      />
    </div>
  );
}

function FolderRows({
  node,
  depth,
  expanded,
  onToggle,
  onAction,
}: {
  node: FolderNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (folderId: string) => void;
  onAction: (action: TreeAction) => void;
}) {
  const isExpanded = expanded.has(node.folder.id);
  const isEmpty = node.subfolders.length === 0 && node.dashboards.length === 0;

  return (
    <>
      <div
        className="group flex items-center gap-1 rounded-md py-1 pr-1 hover:bg-accent/50"
        style={{ paddingLeft: `${depth * 20 + 4}px` }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
          onClick={() => onToggle(node.folder.id)}
        >
          {isExpanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">
            {node.folder.name}
          </span>
        </button>
        <FolderMenu folder={node.folder} onAction={onAction} />
      </div>
      {isExpanded && (
        <>
          {node.subfolders.map((child) => (
            <FolderRows
              key={child.folder.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onAction={onAction}
            />
          ))}
          {node.dashboards.map((dashboard) => (
            <DashboardRow
              key={dashboard.slug}
              dashboard={dashboard}
              depth={depth + 1}
              onAction={onAction}
            />
          ))}
          {isEmpty && (
            <p
              className="py-1.5 text-xs text-muted-foreground"
              style={{ paddingLeft: `${(depth + 1) * 20 + 26}px` }}
            >
              Empty folder
            </p>
          )}
        </>
      )}
    </>
  );
}

function DashboardRow({
  dashboard,
  depth,
  path,
  onAction,
}: {
  dashboard: DashboardSummary;
  depth: number;
  path?: string;
  onAction: (action: TreeAction) => void;
}) {
  return (
    <div
      className="group flex items-center gap-1 rounded-md py-1 pr-1 hover:bg-accent/50"
      style={{ paddingLeft: `${depth * 20 + 26}px` }}
    >
      <Link
        to="/dashboards/$dashboardId"
        params={{ dashboardId: dashboard.slug }}
        className="flex min-w-0 flex-1 items-center gap-2 py-0.5"
      >
        <LayoutDashboard className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm">{dashboard.name}</span>
        {path ? (
          <span className="truncate text-xs text-muted-foreground">{path}</span>
        ) : (
          <span className="truncate text-xs text-muted-foreground">
            {dashboard.slug}
          </span>
        )}
      </Link>
      <DashboardMenu dashboard={dashboard} onAction={onAction} />
    </div>
  );
}

function SearchFolderRow({
  folder,
  path,
  onAction,
}: {
  folder: FolderSummary;
  path: string;
  onAction: (action: TreeAction) => void;
}) {
  return (
    <div className="group flex items-center gap-1 rounded-md py-1 pr-1 pl-1 hover:bg-accent/50">
      <div className="flex min-w-0 flex-1 items-center gap-2 py-0.5">
        <Folder className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{folder.name}</span>
        {path && (
          <span className="truncate text-xs text-muted-foreground">{path}</span>
        )}
      </div>
      <FolderMenu folder={folder} onAction={onAction} />
    </div>
  );
}

function KebabTrigger() {
  return (
    <DropdownMenuTrigger
      render={
        <Button
          variant="ghost"
          size="icon-xs"
          className="opacity-0 group-hover:opacity-100 data-popup-open:opacity-100"
        />
      }
    >
      <EllipsisVertical />
    </DropdownMenuTrigger>
  );
}

function FolderMenu({
  folder,
  onAction,
}: {
  folder: FolderSummary;
  onAction: (action: TreeAction) => void;
}) {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <KebabTrigger />
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() =>
            navigate({ to: "/dashboards/new", search: { folder: folder.id } })
          }
        >
          <Plus />
          New dashboard
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onAction({ type: "create-subfolder", folder })}
        >
          <FolderPlus />
          New subfolder
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onAction({ type: "rename-folder", folder })}
        >
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onAction({ type: "move-folder", folder })}
        >
          <FolderInput />
          Move
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => onAction({ type: "delete-folder", folder })}
        >
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DashboardMenu({
  dashboard,
  onAction,
}: {
  dashboard: DashboardSummary;
  onAction: (action: TreeAction) => void;
}) {
  return (
    <DropdownMenu>
      <KebabTrigger />
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => onAction({ type: "rename-dashboard", dashboard })}
        >
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onAction({ type: "move-dashboard", dashboard })}
        >
          <FolderInput />
          Move to folder
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => onAction({ type: "delete-dashboard", dashboard })}
        >
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
