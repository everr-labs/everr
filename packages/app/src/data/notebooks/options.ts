import { queryOptions } from "@tanstack/react-query";
import { getNotebook, listNotebooks } from "./server";

const notebooksQueryKey = ["notebooks"] as const;

export const notebookOptions = (project: string, slug: string) =>
  queryOptions({
    queryKey: [...notebooksQueryKey, project, slug],
    queryFn: () => getNotebook({ data: { project, slug } }),
  });

export const notebookListOptions = () =>
  queryOptions({
    queryKey: [...notebooksQueryKey, "list"],
    queryFn: () => listNotebooks(),
  });
