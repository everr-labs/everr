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
import { Dialog, DialogContent } from "@everr/ui/components/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { Bot, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  useDeleteServiceAccount,
  useRevokeServiceAccountSecret,
  useRotateServiceAccountSecret,
} from "@/components/service-accounts/queries";
import { SecretReveal } from "@/components/service-accounts/secret-reveal";
import { formatDate } from "@/components/users-management/format-date";
import type {
  ServiceAccountSecretSummary,
  ServiceAccountSummary,
} from "@/data/service-accounts";

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

function relativeFromNow(value?: string | Date | null): string | null {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  const seconds = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  for (const [unit, secs] of RELATIVE_UNITS) {
    if (abs >= secs) return RELATIVE.format(Math.round(seconds / secs), unit);
  }
  return "just now";
}

function exactDate(value: string | Date) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function LastUsed({ value }: { value?: string | Date | null }) {
  const relative = relativeFromNow(value);
  if (!relative || !value) {
    return <span className="text-muted-foreground">Never used</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="cursor-default" />}>
        {relative}
      </TooltipTrigger>
      <TooltipContent>{exactDate(value)}</TooltipContent>
    </Tooltip>
  );
}

function RevokeSecretAction({
  secret,
  accountName,
}: {
  secret: ServiceAccountSecretSummary;
  accountName: string;
}) {
  const revoke = useRevokeServiceAccountSecret();

  const handleRevoke = () => {
    revoke.mutate(
      { secretId: secret.id },
      {
        onSuccess: () =>
          toast.success(`Secret ${secret.start}… revoked for ${accountName}`),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive h-6 px-1.5 text-xs"
          />
        }
      >
        Revoke
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke this secret?</AlertDialogTitle>
          <AlertDialogDescription>
            Any caller using secret {secret.start}… loses access immediately.
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleRevoke}
            className="bg-destructive hover:bg-destructive/90 text-white"
          >
            Revoke secret
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ActiveSecrets({ row }: { row: ServiceAccountSummary }) {
  const active = row.secrets.filter((s) => !s.revokedAt);
  if (active.length === 0) {
    return <span className="text-muted-foreground">None</span>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {active.map((secret) => (
        <div key={secret.id} className="flex items-center gap-2">
          <code className="bg-muted/40 text-muted-foreground rounded border px-1.5 py-0.5 font-mono text-[0.7rem]">
            {secret.start}…
          </code>
          <span className="text-muted-foreground text-xs">
            <LastUsed value={secret.lastUsedAt} />
          </span>
          <RevokeSecretAction secret={secret} accountName={row.name} />
        </div>
      ))}
    </div>
  );
}

// Rotating adds a new secret without disturbing the ones already active, so
// it needs no confirm step. The new secret is shown once, the same reveal
// pattern as account creation, because it can never be shown again.
function RotateSecretButton({ account }: { account: ServiceAccountSummary }) {
  const rotate = useRotateServiceAccountSecret();
  const [open, setOpen] = useState(false);
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next && rotate.isPending) return;
    setOpen(next);
    if (!next) setIssuedSecret(null);
  };

  const handleClick = () => {
    setOpen(true);
    rotate.mutate(
      { serviceAccountId: account.id },
      {
        onSuccess: (data) => setIssuedSecret(data.secret),
        onError: (err) => {
          toast.error(err.message);
          setOpen(false);
        },
      },
    );
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleClick}
        disabled={rotate.isPending}
      >
        Rotate
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          {issuedSecret ? (
            <SecretReveal
              secret={issuedSecret}
              title="Copy the new secret now"
              description="This is the only time the full secret is shown. Store it in your secret manager. The account's earlier secrets stay active until you revoke them."
              onDone={() => handleOpenChange(false)}
            />
          ) : (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function DeleteAccountButton({ account }: { account: ServiceAccountSummary }) {
  const del = useDeleteServiceAccount();

  const handleDelete = () => {
    del.mutate(
      { serviceAccountId: account.id },
      {
        onSuccess: () => toast.success(`${account.name} deleted`),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
          />
        }
      >
        Delete
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{account.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the service account, its membership, and every one of
            its secrets. Any caller still using them loses access immediately.
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-destructive hover:bg-destructive/90 text-white"
          >
            Delete service account
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface ServiceAccountsTableProps {
  accounts: ServiceAccountSummary[];
}

export function ServiceAccountsTable({ accounts }: ServiceAccountsTableProps) {
  const columns: Column<ServiceAccountSummary>[] = [
    {
      header: "Name",
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-md border">
            <Bot className="size-3.5" />
          </span>
          <span className="truncate font-medium">{row.name}</span>
        </div>
      ),
    },
    {
      header: "Role",
      cell: (row) => (
        <Badge variant="outline" className="capitalize">
          {row.role}
        </Badge>
      ),
    },
    {
      header: "Created by",
      cell: (row) => (
        <span className="text-muted-foreground">
          {row.createdByName ?? "Unknown"}
        </span>
      ),
    },
    {
      header: "Created",
      cell: (row) => (
        <span className="text-muted-foreground">
          {formatDate(row.createdAt)}
        </span>
      ),
    },
    {
      header: "Last used",
      cell: (row) => <LastUsed value={row.lastUsedAt} />,
    },
    {
      header: "Active secrets",
      cell: (row) => <ActiveSecrets row={row} />,
    },
    {
      header: <span className="sr-only">Actions</span>,
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <RotateSecretButton account={row} />
          <DeleteAccountButton account={row} />
        </div>
      ),
      cellClassName: "py-2 pr-3 text-right",
      className: "pb-2 pr-3",
    },
  ];

  return (
    <DataTable
      data={accounts}
      columns={columns}
      rowKey={(row) => row.id}
      emptyState={
        <p className="py-8 text-center text-sm text-muted-foreground">
          No service accounts yet.
        </p>
      }
    />
  );
}
