// fallow-ignore-file unused-file
import { queryOptions } from "@tanstack/react-query";
import { getNotebook, listNotebooks } from "./server";

const notebooksQueryKey = ["notebooks"] as const;

/**
 * @expected-unused — UI consumers come in a later task.
 */
export const notebookOptions = (project: string, slug: string) =>
  queryOptions({
    queryKey: [...notebooksQueryKey, project, slug],
    queryFn: () => getNotebook({ data: { project, slug } }),
  });

/**
 * @expected-unused — UI consumers come in a later task.
 */
export const notebookListOptions = () =>
  queryOptions({
    queryKey: [...notebooksQueryKey, "list"],
    queryFn: () => listNotebooks(),
  });
