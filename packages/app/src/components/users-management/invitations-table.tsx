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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { useState } from "react";
import { toast } from "sonner";
import { invitationUrl } from "@/common/invitation";
import { formatDate } from "./format-date";
import { InvitationLink } from "./invitation-link";
import { type Invitation, useRevokeInvitation } from "./queries";

interface InvitationsTableProps {
  invitations: Invitation[];
}

export function InvitationsTable({ invitations }: InvitationsTableProps) {
  const revoke = useRevokeInvitation();
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);

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
      header: <span className="sr-only">Actions</span>,
      cell: (row) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={new Date(row.expiresAt).getTime() <= Date.now()}
            onClick={() =>
              setLink({
                url: invitationUrl(row.id, window.location.origin),
                email: row.email,
              })
            }
          >
            View link
          </Button>
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
        </div>
      ),
      cellClassName: "py-2 pr-3 text-right",
      className: "pb-2 pr-3",
    },
  ];

  return (
    <>
      <DataTable
        data={invitations}
        columns={columns}
        rowKey={(row) => row.id}
      />
      <Dialog
        open={link !== null}
        onOpenChange={(open) => {
          if (!open) setLink(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invitation link</DialogTitle>
            <DialogDescription>
              Share this link with {link?.email}.
            </DialogDescription>
          </DialogHeader>
          {link && <InvitationLink key={link.url} url={link.url} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
