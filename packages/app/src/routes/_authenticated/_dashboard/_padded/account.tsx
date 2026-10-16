import { canDeleteWorkspace } from "@app/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@everr/ui/components/alert-dialog";
import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Input } from "@everr/ui/components/input";
import { RetryError } from "@everr/ui/components/retry-error";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { GoogleConnection } from "@/components/account-settings/google-connection";
import { PasswordSettings } from "@/components/account-settings/password-settings";
import { ProfileSettings } from "@/components/account-settings/profile-settings";
import { linkedAccountsQueryOptions } from "@/components/account-settings/queries";
import { SessionsSettings } from "@/components/account-settings/sessions-settings";
import { PageHeader } from "@/components/page-header";
import { deleteCurrentUserAccount } from "@/data/account-settings";
import { getAuthProviders } from "@/data/auth-providers";
import { authClient } from "@/lib/auth-client";
import { isOrganizationOwner } from "@/lib/organization-role";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_padded/account",
)({
  staticData: { breadcrumb: "Account Settings", hideTimeRangePicker: true },
  head: () => ({
    meta: [{ title: "Everr - Account Settings" }],
  }),
  beforeLoad: () => getAuthProviders(),
  component: AccountSettingsPage,
});

function AccountSettingsPage() {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const { data: activeOrganization } = authClient.useActiveOrganization();
  const { googleSignInEnabled } = Route.useRouteContext();
  const accounts = useQuery(linkedAccountsQueryOptions(session?.user.id ?? ""));
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteOrganization, setDeleteOrganization] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const isDeleteConfirmationValid = deleteConfirmation === "DELETE";
  const activeOrganizationMembers = activeOrganization?.members ?? [];
  const currentMemberRole = activeOrganizationMembers.find(
    (member) => member.userId === session?.user?.id,
  )?.role;
  const canDeleteActiveOrganization =
    canDeleteWorkspace && isOrganizationOwner(currentMemberRole);
  const isOnlyActiveOrganizationOwner =
    canDeleteActiveOrganization &&
    activeOrganizationMembers.filter((member) =>
      isOrganizationOwner(member.role),
    ).length === 1;
  const activeOrganizationName =
    activeOrganization?.name ?? "current organization";

  async function handleDeleteAccount() {
    if (isDeletingAccount || !isDeleteConfirmationValid) {
      return;
    }

    setDeleteError(null);
    setIsDeletingAccount(true);

    try {
      const shouldDeleteOrganization =
        canDeleteActiveOrganization &&
        (deleteOrganization || isOnlyActiveOrganizationOwner);
      await deleteCurrentUserAccount({
        data: shouldDeleteOrganization
          ? { confirmation: "DELETE", deleteOrganization: true }
          : { confirmation: "DELETE" },
      });
      await navigate({ to: "/" });
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "We couldn't delete your account right now.",
      );
    } finally {
      setIsDeletingAccount(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
      <PageHeader
        title="Account Settings"
        lede="Manage your profile and account lifecycle."
      />

      {session?.user && (
        <>
          <ProfileSettings key={session.user.id} user={session.user} />
          {accounts.isPending && (
            <Skeleton className="h-40" aria-label="Loading sign-in methods" />
          )}
          {accounts.isError && (
            <RetryError
              variant="inline"
              title="Could not load sign-in methods"
              message={accounts.error.message}
              onRetry={() => void accounts.refetch()}
            />
          )}
          {accounts.data && (
            <>
              <PasswordSettings
                key={session.user.id}
                hasPassword={accounts.data.some(
                  (account) => account.providerId === "credential",
                )}
              />
              {googleSignInEnabled && (
                <GoogleConnection
                  linked={accounts.data.some(
                    (account) => account.providerId === "google",
                  )}
                />
              )}
            </>
          )}
          <SessionsSettings
            key={session.session.id}
            userId={session.user.id}
            currentSessionId={session.session.id}
          />
        </>
      )}

      <Card className="border-destructive/40">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Danger Zone</CardTitle>
            <CardDescription>
              Deleting your account is permanent and cannot be undone
            </CardDescription>
          </div>
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="destructive" size="lg" />}
            >
              Delete account
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete account</AlertDialogTitle>
                <AlertDialogDescription>
                  Type <strong>DELETE</strong> to confirm permanent account
                  deletion
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="delete-confirmation"
                  className="text-xs font-medium"
                >
                  Confirmation
                </label>
                <Input
                  id="delete-confirmation"
                  placeholder="Type DELETE"
                  value={deleteConfirmation}
                  onChange={(event) =>
                    setDeleteConfirmation(event.target.value)
                  }
                />
                {canDeleteActiveOrganization &&
                isOnlyActiveOrganizationOwner ? (
                  <p className="rounded-md border border-destructive/20 bg-destructive/5 p-2 text-xs font-medium">
                    This action is also going to delete the{" "}
                    {activeOrganizationName} organization.
                  </p>
                ) : canDeleteActiveOrganization ? (
                  <label
                    htmlFor="delete-organization"
                    className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 p-2 text-xs"
                  >
                    <input
                      id="delete-organization"
                      type="checkbox"
                      aria-label={`Delete ${activeOrganizationName} organization too`}
                      className="mt-0.5 size-3.5 accent-current"
                      checked={deleteOrganization}
                      onChange={(event) =>
                        setDeleteOrganization(event.target.checked)
                      }
                    />
                    <span className="flex flex-col gap-1">
                      <span className="font-medium">
                        Delete {activeOrganizationName} organization too
                      </span>
                      <span className="text-muted-foreground">
                        Leave this unchecked to remove only your account and
                        keep the organization.
                      </span>
                    </span>
                  </label>
                ) : null}
                {deleteError ? (
                  <p className="text-xs text-destructive" role="alert">
                    {deleteError}
                  </p>
                ) : null}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeletingAccount}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={!isDeleteConfirmationValid || isDeletingAccount}
                  onClick={() => void handleDeleteAccount()}
                >
                  {isDeletingAccount ? "Deleting..." : "Delete permanently"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardHeader>
      </Card>
    </div>
  );
}
