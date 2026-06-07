import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertCircle,
  FolderPlus,
  LayoutDashboard,
  Plus,
  SearchIcon,
} from "lucide-react";
import { useState } from "react";
import { DashboardTree } from "@/components/dashboards/dashboard-tree";
import { NameDialog } from "@/components/dashboards/name-dialog";
import {
  dashboardListOptions,
  folderListOptions,
  useCreateFolder,
} from "@/data/dashboards/options";

export const Route = createFileRoute("/_authenticated/_dashboard/dashboards/")({
  staticData: { breadcrumb: "Dashboards" },
  head: () => ({
    meta: [{ title: "Everr - Dashboards" }],
  }),
  component: DashboardsIndexPage,
});

function DashboardsIndexPage() {
  const {
    data: dashboards,
    isLoading: dashboardsLoading,
    error: dashboardsError,
    isError: dashboardsIsError,
  } = useQuery(dashboardListOptions());
  const {
    data: folders,
    isLoading: foldersLoading,
    error: foldersError,
    isError: foldersIsError,
  } = useQuery(folderListOptions());
  const [search, setSearch] = useState("");
  // null = dialog closed; "root" sentinel = create at root; uuid = subfolder
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const createFolder = useCreateFolder();

  const isLoading = dashboardsLoading || foldersLoading;
  const isError = dashboardsIsError || foldersIsError;
  const error = dashboardsError ?? foldersError;
  const isEmpty =
    !isLoading &&
    !isError &&
    (dashboards?.length ?? 0) === 0 &&
    (folders?.length ?? 0) === 0;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Dashboards</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreateParentId("root")}
          >
            <FolderPlus data-icon="inline-start" />
            New Folder
          </Button>
          <Button size="sm" render={<Link to="/dashboards/new" />}>
            <Plus data-icon="inline-start" />
            New Dashboard
          </Button>
        </div>
      </div>

      <div className="relative mb-4 max-w-sm">
        <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search dashboards..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!isLoading && isError && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <AlertCircle className="size-10" />
          <p className="text-sm">
            {error instanceof Error
              ? error.message
              : "Failed to load dashboards"}
          </p>
        </div>
      )}

      {isEmpty && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <LayoutDashboard className="size-10" />
          <p className="text-sm">No dashboards yet</p>
          <Button
            variant="outline"
            size="sm"
            render={<Link to="/dashboards/new" />}
          >
            <Plus data-icon="inline-start" />
            Create your first dashboard
          </Button>
        </div>
      )}

      {!isLoading && !isError && !isEmpty && (
        <DashboardTree
          folders={folders ?? []}
          dashboards={dashboards ?? []}
          search={search}
          onCreateSubfolder={(parentId) => setCreateParentId(parentId)}
        />
      )}

      <NameDialog
        open={createParentId !== null}
        onOpenChange={(open) => {
          if (!open) setCreateParentId(null);
        }}
        title={createParentId === "root" ? "New folder" : "New subfolder"}
        confirmLabel="Create"
        isPending={createFolder.isPending}
        onConfirm={(name) => {
          createFolder.mutate(
            {
              name,
              parentId:
                createParentId === "root"
                  ? undefined
                  : (createParentId ?? undefined),
            },
            { onSuccess: () => setCreateParentId(null) },
          );
        }}
      />
    </div>
  );
}
