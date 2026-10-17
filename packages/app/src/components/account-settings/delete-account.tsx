import { useNavigate } from "@tanstack/react-router";
import { deleteCurrentUserAccount } from "@/data/account-settings";
import { DeleteAccountDialog } from "./delete-account-dialog";

export function DeleteAccount() {
  const navigate = useNavigate();
  return (
    <DeleteAccountDialog
      onDelete={async () => {
        await deleteCurrentUserAccount({ data: { confirmation: "DELETE" } });
        await navigate({ to: "/" });
      }}
    />
  );
}
