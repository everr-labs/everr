import { createFileRoute, notFound } from "@tanstack/react-router";
import { GithubPage, githubInstallStatusOptions } from "#app/integrations/github/page.tsx";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_padded/_admin/github",
)({
  staticData: { breadcrumb: "GitHub", hideTimeRangePicker: true },
  beforeLoad: ({ context: { githubEnabled } }) => {
    if (!githubEnabled) throw notFound();
  },
  loader: async ({ context: { queryClient } }) => {
    await queryClient.prefetchQuery(githubInstallStatusOptions);
  },
  head: () => ({ meta: [{ title: "Everr - GitHub" }] }),
  component: GithubPage,
});
