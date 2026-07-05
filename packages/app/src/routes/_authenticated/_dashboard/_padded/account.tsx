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
import { Badge } from "@everr/ui/components/badge";
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
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { siGoogle } from "simple-icons";
import { deleteCurrentUserAccount } from "@/data/account-settings";
import { authClient } from "@/lib/auth-client";

type LinkedAccount = NonNullable<
  Awaited<ReturnType<typeof authClient.listAccounts>>["data"]
>[number];

export const Route = createFileRoute("/_authenticated/_dashboard/_padded/account")({
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
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[]>([]);
  const [isLoadingLinkedAccounts, setIsLoadingLinkedAccounts] = useState(true);
  const [googleLinkError, setGoogleLinkError] = useState<string | null>(null);
  const [isLinkingGoogle, setIsLinkingGoogle] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteOrganization, setDeleteOrganization] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const isGoogleLinked = linkedAccounts.some((account) => account.providerId === "google");
  const isDeleteConfirmationValid = deleteConfirmation === "DELETE";
  const activeOrganizationMembers = activeOrganization?.members ?? [];
  const currentMemberRole = activeOrganizationMembers.find(
    (member) => member.userId === session?.user?.id,
  )?.role;
  const canDeleteActiveOrganization = isOrgOwnerRole(currentMemberRole);
  const isOnlyActiveOrganizationOwner =
    canDeleteActiveOrganization &&
    activeOrganizationMembers.filter((member) => isOrgOwnerRole(member.role)).length === 1;
  const activeOrganizationName = activeOrganization?.name ?? "current organization";
  const googleButtonLabel = isLoadingLinkedAccounts
    ? "Checking..."
    : isLinkingGoogle
      ? "Connecting..."
      : isGoogleLinked
        ? "Linked"
        : "Connect Google";

  useEffect(() => {
    let isCurrent = true;

    async function loadLinkedAccounts() {
      setIsLoadingLinkedAccounts(true);

      try {
        const result = await authClient.listAccounts();
        if (!isCurrent) {
          return;
        }

        if (result.error) {
          setGoogleLinkError(
            result.error.message ?? "We couldn't load your connected accounts right now.",
          );
          return;
        }

        setLinkedAccounts(result.data ?? []);
      } catch (error) {
        if (!isCurrent) {
          return;
        }

        setGoogleLinkError(
          error instanceof Error
            ? error.message
            : "We couldn't load your connected accounts right now.",
        );
      } finally {
        if (isCurrent) {
          setIsLoadingLinkedAccounts(false);
        }
      }
    }

    void loadLinkedAccounts();

    return () => {
      isCurrent = false;
    };
  }, []);

  async function handleLinkGoogle() {
    if (isLoadingLinkedAccounts || isLinkingGoogle || isGoogleLinked) {
      return;
    }

    setGoogleLinkError(null);
    setIsLinkingGoogle(true);

    try {
      const result = await authClient.linkSocial({
        callbackURL: "/account",
        provider: "google",
      });

      if (result.error) {
        setGoogleLinkError(result.error.message ?? "Google linking failed.");
        setIsLinkingGoogle(false);
      }
    } catch (error) {
      setGoogleLinkError(error instanceof Error ? error.message : "Google linking failed.");
      setIsLinkingGoogle(false);
    }
  }

  async function handleDeleteAccount() {
    if (isDeletingAccount || !isDeleteConfirmationValid) {
      return;
    }

    setDeleteError(null);
    setIsDeletingAccount(true);

    try {
      const shouldDeleteOrganization =
        canDeleteActiveOrganization && (deleteOrganization || isOnlyActiveOrganizationOwner);
      await deleteCurrentUserAccount({
        data: shouldDeleteOrganization
          ? { confirmation: "DELETE", deleteOrganization: true }
          : { confirmation: "DELETE" },
      });
      await navigate({ to: "/" });
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "We couldn't delete your account right now.",
      );
    } finally {
      setIsDeletingAccount(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Account Settings</h1>
        <p className="text-muted-foreground">Manage your profile and account lifecycle.</p>
      </div>

      {/* TODO: Replace WorkOS UserProfile/UserSecurity widgets with better-auth equivalents */}

      <Card>
        <CardHeader>
          <CardTitle>Google Connection</CardTitle>
          <CardDescription>Link Google to sign in to this account with Google.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                <GoogleIcon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">Google</p>
                <p className="text-xs text-muted-foreground">
                  {isGoogleLinked
                    ? "Google is linked as a sign-in method for this account."
                    : "Use Google as an additional sign-in method for this account."}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isGoogleLinked ? <Badge variant="secondary">Connected</Badge> : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isLoadingLinkedAccounts || isLinkingGoogle || isGoogleLinked}
                onClick={() => void handleLinkGoogle()}
              >
                {isLinkingGoogle ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <GoogleIcon dataIcon="inline-start" />
                )}
                {googleButtonLabel}
              </Button>
            </div>
          </div>
          {googleLinkError ? (
            <p className="text-xs text-destructive" role="alert">
              {googleLinkError}
            </p>
          ) : null}
        </CardContent>
      </Card>

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
          <div className="flex flex-col gap-1">
            <CardTitle>Danger Zone</CardTitle>
            <CardDescription>
              Deleting your account is permanent and cannot be undone
            </CardDescription>
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
                {canDeleteActiveOrganization && isOnlyActiveOrganizationOwner ? (
                  <p className="rounded-md border border-destructive/20 bg-destructive/5 p-2 text-xs font-medium">
                    This action is also going to delete the {activeOrganizationName} organization.
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
                      onChange={(event) => setDeleteOrganization(event.target.checked)}
                    />
                    <span className="flex flex-col gap-1">
                      <span className="font-medium">
                        Delete {activeOrganizationName} organization too
                      </span>
                      <span className="text-muted-foreground">
                        Leave this unchecked to remove only your account and keep the organization.
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

function GoogleIcon({ className, dataIcon }: { className?: string; dataIcon?: "inline-start" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      data-icon={dataIcon}
    >
      <path d={siGoogle.path} />
    </svg>
  );
}
