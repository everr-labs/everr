import { createFileRoute, notFound } from "@tanstack/react-router";
import { getGithubAvailability } from "@/integrations/github/data";
import {
  GithubPage,
  githubInstallStatusOptions,
} from "@/integrations/github/page";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_padded/_admin/github",
)({
  staticData: { breadcrumb: "GitHub", hideTimeRangePicker: true },
  head: () => ({ meta: [{ title: "Everr - GitHub" }] }),
  beforeLoad: async () => {
    if (!(await getGithubAvailability()).enabled) throw notFound();
  },
  loader: async ({ context: { queryClient } }) => {
    await queryClient.prefetchQuery(githubInstallStatusOptions);
  },
  component: GithubPage,
});
