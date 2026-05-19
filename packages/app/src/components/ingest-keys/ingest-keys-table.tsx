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
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { toast } from "sonner";
import { formatDate } from "@/components/users-management/format-date";
import {
  type IngestKey,
  readAllowedOrigins,
  useRevokeIngestKey,
} from "./queries";

interface IngestKeysTableProps {
  keys: IngestKey[];
}

function dimmedDate(value: string | Date | null | undefined) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return formatDate(value);
}

export function IngestKeysTable({ keys }: IngestKeysTableProps) {
  const revoke = useRevokeIngestKey();

  const handleRevoke = (id: string, name: string | null | undefined) => {
    revoke.mutate(id, {
      onSuccess: () =>
        toast.success(
          `Ingest key ${name ?? id} revoked. Effective within 30s.`,
        ),
      onError: (err) => toast.error(err.message),
    });
  };

  const columns: Column<IngestKey>[] = [
    {
      header: "Name",
      cell: (row) =>
        row.name ?? <span className="text-muted-foreground">—</span>,
    },
    {
      header: "Prefix",
      cell: (row) => (
        <code className="text-xs">{row.start ?? row.prefix ?? "—"}…</code>
      ),
    },
    {
      header: "Created",
      cell: (row) => dimmedDate(row.createdAt as unknown as string),
    },
    {
      header: "Expires",
      cell: (row) => dimmedDate(row.expiresAt as unknown as string | null),
    },
    {
      header: "Allowed origins",
      cell: (row) => {
        const origins = readAllowedOrigins(row);
        if (origins.length === 0) {
          return <span className="text-muted-foreground">Any origin</span>;
        }
        return (
          <div className="flex flex-col gap-0.5">
            {origins.map((origin) => (
              <code key={origin} className="text-xs">
                {origin}
              </code>
            ))}
          </div>
        );
      },
    },
    {
      header: "Last used",
      cell: (row) =>
        dimmedDate((row as { lastRequest?: string | null }).lastRequest),
    },
    {
      header: <span className="sr-only">Actions</span>,
      cell: (row) => (
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
            Revoke
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke ingest key</AlertDialogTitle>
              <AlertDialogDescription>
                Any service still using this key will start receiving 401s
                within ~30 seconds. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => handleRevoke(row.id, row.name)}>
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

  return <DataTable data={keys} columns={columns} rowKey={(row) => row.id} />;
}
