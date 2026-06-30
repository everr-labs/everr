import { queryOptions } from "@tanstack/react-query";
import { getRunbook, listRunbooks } from "./server";

const runbooksQueryKey = ["runbooks"] as const;

export const runbookOptions = (project: string, slug: string) =>
  queryOptions({
    queryKey: [...runbooksQueryKey, project, slug],
    queryFn: () => getRunbook({ data: { project, slug } }),
    // Immutable (gitops); never auto-refetch on scroll-back of a card preview.
    staleTime: Number.POSITIVE_INFINITY,
  });

export const runbookListOptions = () =>
  queryOptions({
    queryKey: [...runbooksQueryKey, "list"],
    queryFn: () => listRunbooks(),
  });
