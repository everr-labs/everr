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
import { Button, buttonVariants } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Input } from "@everr/ui/components/input";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { deleteCurrentUserAccount } from "@/data/account-settings";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_authenticated/_dashboard/account")({
  staticData: { breadcrumb: "Account Settings", hideTimeRangePicker: true },
  head: () => ({
    meta: [{ title: "Everr - Account Settings" }],
  }),
  component: AccountSettingsPage,
});

function AccountSettingsPage() {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const { data: activeOrganization } = authClient.useActiveOrganization();
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteOrganization, setDeleteOrganization] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const isDeleteConfirmationValid = deleteConfirmation === "DELETE";
  const currentMemberRole = activeOrganization?.members?.find(
    (member) => member.userId === session?.user?.id,
  )?.role;
  const canDeleteActiveOrganization = isOrgOwnerRole(currentMemberRole);
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
        canDeleteActiveOrganization && deleteOrganization;
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
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Account Settings</h1>
        <p className="text-muted-foreground">
          Manage your profile and account lifecycle.
        </p>
      </div>

      {/* TODO: Replace WorkOS UserProfile/UserSecurity widgets with better-auth equivalents */}

      <Card>
        <CardHeader>
          <CardTitle>GitHub Connection</CardTitle>
          <CardDescription>
            Connect or update your GitHub App installation for this workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            to="/api/github/install/start"
            reloadDocument
            className={buttonVariants({ size: "sm" })}
          >
            Connect GitHub
          </Link>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="space-y-1">
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
              <div className="space-y-2">
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
                {canDeleteActiveOrganization ? (
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

function isOrgOwnerRole(role: string | null | undefined) {
  return (
    role
      ?.split(",")
      .map((part) => part.trim())
      .some((part) => part === "owner") ?? false
  );
}
