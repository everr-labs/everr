import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { createContractRouter } from "../contract/router";
import type { ExploreBackend } from "../explore/backend";
import { fakeExploreBackend } from "./backend";

/** Renders the contract router at `url`, the way an app mounts the Explore routes. */
export function renderExplore(url: string, explore: ExploreBackend = fakeExploreBackend()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createContractRouter(url, { queryClient, explore });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
}
