import { pages } from "@composition/pages";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_padded/account",
)({
  staticData: { breadcrumb: "Account Settings", hideTimeRangePicker: true },
  head: () => ({
    meta: [{ title: "Everr - Account Settings" }],
  }),
  component: AccountSettingsPage,
});

function AccountSettingsPage() {
  const { googleSignInEnabled } = Route.useRouteContext();
  return <pages.account googleSignInEnabled={googleSignInEnabled} />;
}
