import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAccessToken } from "@workos/authkit-tanstack-react-start/client";
import { UserProfile, UserSecurity } from "@workos-inc/widgets";
import { useState } from "react";
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
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { deleteCurrentUserAccount } from "@/data/account-settings";

export const Route = createFileRoute("/_authenticated/_dashboard/account")({
  staticData: { breadcrumb: "Account Settings", hideTimeRangePicker: true },
  head: () => ({
    meta: [{ title: "Everr - Account Settings" }],
  }),
  component: AccountSettingsPage,
});

function AccountSettingsPage() {
  const navigate = useNavigate();
  const { accessToken } = useAccessToken();
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  if (!accessToken) {
    return null;
  }

  const isDeleteConfirmationValid = deleteConfirmation === "DELETE";

  async function handleDeleteAccount() {
    if (isDeletingAccount || !isDeleteConfirmationValid) {
      return;
    }

    setDeleteError(null);
    setIsDeletingAccount(true);

    try {
      await deleteCurrentUserAccount({
        data: { confirmation: "DELETE" },
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
          Manage your profile, password access, and account lifecycle.
        </p>
      </div>

      <UserProfile authToken={accessToken} />
      <UserSecurity authToken={accessToken} />
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
