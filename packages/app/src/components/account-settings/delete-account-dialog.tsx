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
import { Card, CardDescription, CardHeader, CardTitle } from "@everr/ui/components/card";
import { Input } from "@everr/ui/components/input";
import { type ReactNode, useState } from "react";

export function DeleteAccountDialog({
  children,
  onDelete,
}: {
  children?: ReactNode;
  onDelete: () => Promise<void>;
}) {
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const isDeleteConfirmationValid = deleteConfirmation === "DELETE";

  async function handleDeleteAccount() {
    if (isDeletingAccount || !isDeleteConfirmationValid) return;
    setDeleteError(null);
    setIsDeletingAccount(true);
    try {
      await onDelete();
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "We couldn't delete your account right now.",
      );
    } finally {
      setIsDeletingAccount(false);
    }
  }
  return (
    <Card className="border-destructive/40">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>Danger Zone</CardTitle>
          <CardDescription>Deleting your account is permanent and cannot be undone</CardDescription>
        </div>
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive" size="lg" />}>
            Delete account
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete account</AlertDialogTitle>
              <AlertDialogDescription>
                Type <strong>DELETE</strong> to confirm permanent account deletion
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-col gap-2">
              <label htmlFor="delete-confirmation" className="text-xs font-medium">
                Confirmation
              </label>
              <Input
                id="delete-confirmation"
                placeholder="Type DELETE"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
              />
              {children}
              {deleteError ? (
                <p className="text-xs text-destructive" role="alert">
                  {deleteError}
                </p>
              ) : null}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeletingAccount}>Cancel</AlertDialogCancel>
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
  );
}
