import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { deleteCurrentUserAccount } from "#app/data/account-settings.ts";
import { DeleteAccountDialog } from "./delete-account-dialog";

export function DeleteAccount() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <DeleteAccountDialog
      onDelete={async () => {
        await deleteCurrentUserAccount({ data: { confirmation: "DELETE" } });
        queryClient.clear();
        await navigate({ to: "/" });
      }}
    />
  );
}
