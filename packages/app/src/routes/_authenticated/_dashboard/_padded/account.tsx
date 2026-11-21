import { pages } from "@composition/pages";
import { createFileRoute } from "@tanstack/react-router";
import {
  accountSessionsQueryOptions,
  linkedAccountsQueryOptions,
  mcpConnectionsQueryOptions,
} from "#app/components/account-settings/queries.ts";

export const Route = createFileRoute("/_authenticated/_dashboard/_padded/account")({
  staticData: { breadcrumb: "Account Settings", hideTimeRangePicker: true },
  // Prefetched so the cards render complete. `prefetchQuery` never throws; each
  // card shows its own failure.
  loader: async ({ context: { queryClient, session } }) => {
    await Promise.all([
      queryClient.prefetchQuery(linkedAccountsQueryOptions(session.user.id)),
      queryClient.prefetchQuery(accountSessionsQueryOptions(session.user.id)),
      queryClient.prefetchQuery(mcpConnectionsQueryOptions(session.user.id)),
    ]);
  },
  head: () => ({
    meta: [{ title: "Everr - Account Settings" }],
  }),
  component: AccountSettingsPage,
});

function AccountSettingsPage() {
  const { googleSignInEnabled } = Route.useRouteContext();
  return <pages.account googleSignInEnabled={googleSignInEnabled} />;
}
