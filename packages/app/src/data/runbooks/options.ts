import { queryOptions } from "@tanstack/react-query";
import { getRunbook, listRunbooks } from "./server";

const runbooksQueryKey = ["runbooks"] as const;

export const runbookOptions = (project: string, slug: string) =>
  queryOptions({
    queryKey: [...runbooksQueryKey, project, slug],
    queryFn: () => getRunbook({ data: { project, slug } }),
  });

export const runbookListOptions = () =>
  queryOptions({
    queryKey: [...runbooksQueryKey, "list"],
    queryFn: () => listRunbooks(),
  });
