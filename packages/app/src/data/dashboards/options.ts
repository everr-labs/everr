import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { VariableMeta, VariableValues } from "./interpolate";
import {
  createDashboard,
  createFolder,
  deleteDashboard,
  deleteFolder,
  getDashboard,
  listDashboards,
  listFolders,
  moveDashboard,
  moveFolder,
  renameDashboard,
  renameFolder,
  runPanelQuery,
  runVariableOptionsQuery,
  saveDashboard,
} from "./server";

const dashboardsQueryKey = ["dashboards"] as const;
const foldersQueryKey = ["dashboard-folders"] as const;

export const dashboardOptions = (dashboardId: string) =>
  queryOptions({
    queryKey: [...dashboardsQueryKey, dashboardId],
    queryFn: () => getDashboard({ data: { dashboardId } }),
  });

export const dashboardListOptions = () =>
  queryOptions({
    queryKey: [...dashboardsQueryKey, "list"],
    queryFn: () => listDashboards(),
  });

export const folderListOptions = () =>
  queryOptions({
    queryKey: foldersQueryKey,
    queryFn: () => listFolders(),
  });

export const panelQueryOptions = (
  sql: string,
  from?: string,
  to?: string,
  variables?: VariableValues,
  variableMeta?: VariableMeta,
) =>
  queryOptions({
    queryKey: [
      "panel-query",
      sql,
      from,
      to,
      variables ?? null,
      variableMeta ?? null,
    ],
    queryFn: () =>
      runPanelQuery({ data: { sql, from, to, variables, variableMeta } }),
    enabled: sql.trim().length > 0,
  });

export const variableOptionsQueryOptions = (
  query: string,
  from?: string,
  to?: string,
) =>
  queryOptions({
    queryKey: ["variable-options", query, from, to],
    queryFn: () => runVariableOptionsQuery({ data: { query, from, to } }),
    enabled: query.trim().length > 0,
  });

export function useSaveDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      slug: string;
      newSlug?: string;
      spec: Parameters<typeof saveDashboard>[0]["data"]["spec"];
      folderId?: string;
    }) => saveDashboard({ data: vars }),
    onSuccess: () => {
      // Prefix-matches every dashboard query, including the old slug's
      // dashboardOptions after a rename.
      void qc.invalidateQueries({ queryKey: dashboardsQueryKey });
      toast.success("Dashboard saved");
    },
  });
}

export function useCreateDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      slug?: string;
      spec: Parameters<typeof createDashboard>[0]["data"]["spec"];
      folderId?: string;
    }) => createDashboard({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dashboardsQueryKey });
      toast.success("Dashboard created");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create");
    },
  });
}

export function useDeleteDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => deleteDashboard({ data: { slug } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dashboardsQueryKey });
      toast.success("Dashboard deleted");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete");
    },
  });
}

export function useRenameDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { slug: string; name: string }) =>
      renameDashboard({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dashboardsQueryKey });
      toast.success("Dashboard renamed");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to rename");
    },
  });
}

export function useMoveDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { slug: string; folderId: string | null }) =>
      moveDashboard({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dashboardsQueryKey });
      toast.success("Dashboard moved");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to move");
    },
  });
}

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; parentId?: string }) =>
      createFolder({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: foldersQueryKey });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to create folder",
      );
    },
  });
}

export function useRenameFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { folderId: string; name: string }) =>
      renameFolder({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: foldersQueryKey });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to rename folder",
      );
    },
  });
}

export function useMoveFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { folderId: string; parentId: string | null }) =>
      moveFolder({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: foldersQueryKey });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to move folder",
      );
    },
  });
}

export function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      folderId: string;
      mode: "cascade" | "move-to-root";
    }) => deleteFolder({ data: vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: foldersQueryKey });
      void qc.invalidateQueries({ queryKey: dashboardsQueryKey });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete folder",
      );
    },
  });
}
