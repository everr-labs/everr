import { DeleteAccountDialog } from "@everr/app/account-settings/dialog";
import { deleteCurrentUserAccount } from "@everr/app/account-settings/actions";
import { authClient } from "@everr/app/lib/auth-client";
import { isOrganizationOwner } from "@everr/app/lib/organization-role";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

export function AccountDeletion() {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const { data: activeOrganization } = authClient.useActiveOrganization();
  const [deleteOrganization, setDeleteOrganization] = useState(false);

  const activeOrganizationMembers = activeOrganization?.members ?? [];
  const currentMemberRole = activeOrganizationMembers.find(
    (member) => member.userId === session?.user?.id,
  )?.role;
  const canDeleteActiveOrganization = isOrganizationOwner(currentMemberRole);
  const isOnlyActiveOrganizationOwner =
    canDeleteActiveOrganization &&
    activeOrganizationMembers.filter((member) =>
      isOrganizationOwner(member.role),
    ).length === 1;
  const activeOrganizationName =
    activeOrganization?.name ?? "current organization";

  return (
    <DeleteAccountDialog
      onDelete={async () => {
        const shouldDeleteOrganization =
          canDeleteActiveOrganization &&
          (deleteOrganization || isOnlyActiveOrganizationOwner);
        await deleteCurrentUserAccount({
          data: shouldDeleteOrganization
            ? { confirmation: "DELETE", deleteOrganization: true }
            : { confirmation: "DELETE" },
        });
        await navigate({ to: "/" });
      }}
    >
      {canDeleteActiveOrganization && isOnlyActiveOrganizationOwner ? (
        <p className="rounded-md border border-destructive/20 bg-destructive/5 p-2 text-xs font-medium">
          This action is also going to delete the {activeOrganizationName}{" "}
          organization.
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
              Leave this unchecked to remove only your account and keep the
              organization.
            </span>
          </span>
        </label>
      ) : null}
    </DeleteAccountDialog>
  );
}
