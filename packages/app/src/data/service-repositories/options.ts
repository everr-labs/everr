import { queryOptions } from "@tanstack/react-query";
import { getServiceRepositoryLinks } from "./server";

export const serviceRepositoriesQueryKey = ["service-repositories"] as const;

export const serviceRepositoryLinksOptions = (environment?: string) =>
  queryOptions({
    queryKey: [...serviceRepositoriesQueryKey, environment ?? null],
    queryFn: () => getServiceRepositoryLinks({ data: { environment } }),
    // A scan over a week of logs: worth reusing across page views.
    staleTime: 5 * 60_000,
  });
