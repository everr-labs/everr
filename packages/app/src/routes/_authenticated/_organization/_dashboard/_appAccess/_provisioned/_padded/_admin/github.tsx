import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  GithubPage,
  githubInstallStatusOptions,
  githubReposOptions,
} from "#app/integrations/github/page.tsx";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_padded/_admin/github",
)({
  staticData: { breadcrumb: "GitHub", hideTimeRangePicker: true },
  beforeLoad: ({ context: { githubEnabled } }) => {
    if (!githubEnabled) throw notFound();
  },
  loader: async ({ context: { queryClient } }) => {
    await queryClient.prefetchQuery(githubInstallStatusOptions);
    // Started, not awaited: the list comes from GitHub's API, not a local
    // read, and the page should not wait on it. Starting here still shortens
    // the spinner the import card shows.
    const installations = queryClient.getQueryData(githubInstallStatusOptions.queryKey);
    if (installations?.some((installation) => installation.installed)) {
      void queryClient.prefetchQuery(githubReposOptions);
    }
  },
  head: () => ({ meta: [{ title: "Everr - GitHub" }] }),
  component: GithubPage,
});
