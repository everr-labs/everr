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
import { Button } from "@everr/ui/components/button";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { toast } from "sonner";
import { type Invitation, useRevokeInvitation } from "./queries";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function formatDate(dateStr: string | Date) {
  try {
    return dateFormatter.format(new Date(dateStr));
  } catch {
    return String(dateStr);
  }
}

interface InvitationsTableProps {
  invitations: Invitation[];
}

export function InvitationsTable({ invitations }: InvitationsTableProps) {
  const revoke = useRevokeInvitation();

  const handleRevoke = (invitationId: string, email: string) => {
    revoke.mutate(invitationId, {
      onSuccess: () => toast.success(`Invitation to ${email} revoked`),
      onError: (err) => toast.error(err.message),
    });
  };

  const columns: Column<Invitation>[] = [
    { header: "Email", cell: (row) => row.email },
    {
      header: "Role",
      cell: (row) => (
        <Badge variant="outline" className="capitalize">
          {row.role}
        </Badge>
      ),
    },
    {
      header: "Expires",
      cell: (row) => formatDate(row.expiresAt),
    },
    {
      header: "",
      cell: (row) => (
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
            Revoke
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke invitation</AlertDialogTitle>
              <AlertDialogDescription>
                This will cancel the invitation to {row.email}. They won't be
                able to join using this link.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => handleRevoke(row.id, row.email)}
              >
                Revoke
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ),
      cellClassName: "py-2 pr-3 text-right",
      className: "pb-2 pr-3",
    },
  ];

  return (
    <DataTable data={invitations} columns={columns} rowKey={(row) => row.id} />
  );
}
