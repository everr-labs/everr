import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createFolder,
  deleteDashboard,
  deleteFolder,
  getDashboard,
  listDashboards,
  renameFolder,
  runPanelQuery,
  saveDashboard,
} from "./server";

const dashboardsQueryKey = ["dashboards"] as const;

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

export const panelQueryOptions = (sql: string, from?: string, to?: string) =>
  queryOptions({
    queryKey: ["panel-query", sql, from, to],
    queryFn: () => runPanelQuery({ data: { sql, from, to } }),
    enabled: sql.trim().length > 0,
  });

export function useSaveDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      slug: string;
      spec: Parameters<typeof saveDashboard>[0]["data"]["spec"];
      folderId?: string;
    }) => saveDashboard({ data: vars }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: [...dashboardsQueryKey, vars.slug],
      });
      toast.success("Dashboard saved");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save");
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

const foldersQueryKey = ["dashboard-folders"] as const;

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
