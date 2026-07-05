import { queryOptions } from "@tanstack/react-query";
import { getRunbook, listRunbooks } from "./server";

const runbooksQueryKey = ["runbooks"] as const;

export const runbookOptions = (
  project: string,
  slug: string,
  preview?: string,
) =>
  queryOptions({
    queryKey: [...runbooksQueryKey, project, slug, preview ?? ""],
    queryFn: () => getRunbook({ data: { project, slug, preview } }),
  });

export const runbookListOptions = (preview?: string) =>
  queryOptions({
    queryKey: [...runbooksQueryKey, "list", preview ?? ""],
    queryFn: () => listRunbooks({ data: { preview } }),
  });
