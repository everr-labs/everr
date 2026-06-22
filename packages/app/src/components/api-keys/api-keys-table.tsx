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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { toast } from "sonner";
import { formatDate } from "@/components/users-management/format-date";
import {
  API_KEY_SCOPES,
  type ApiKeyPermissions,
  describeApiKeyScopes,
} from "@/lib/api-key-scopes";
import { type ApiKey, useRevokeApiKey } from "./queries";
import { SCOPE_ICONS } from "./scope-meta";

interface ApiKeysTableProps {
  keys: ApiKey[];
}

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

function permissionsOf(row: ApiKey): ApiKeyPermissions {
  const raw = row.permissions;
  if (!raw || typeof raw !== "object") return null;
  return raw;
}

function ScopeBadges({ row }: { row: ApiKey }) {
  const scopes = describeApiKeyScopes(permissionsOf(row));
  if (scopes.length === 0) {
    return <span className="text-muted-foreground">none</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {scopes.map((scope) => {
        const meta = API_KEY_SCOPES[scope];
        const Icon = SCOPE_ICONS[scope];
        if (!meta) return null;
        return (
          <Tooltip key={scope}>
            <TooltipTrigger
              render={<Badge variant="outline" className="gap-1" />}
            >
              {Icon ? <Icon /> : null}
              {meta.label}
            </TooltipTrigger>
            <TooltipContent>{meta.description}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function LastUsed({ row }: { row: ApiKey }) {
  const value = row.lastRequest;
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

function Expiry({ row }: { row: ApiKey }) {
  const value = row.expiresAt;
  if (!value) return <span className="text-muted-foreground">Never</span>;
  const expired = new Date(value).getTime() < Date.now();
  if (expired) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="text-destructive cursor-default font-medium" />
          }
        >
          Expired
        </TooltipTrigger>
        <TooltipContent>{exactDate(value)}</TooltipContent>
      </Tooltip>
    );
  }
  return <span>{formatDate(value)}</span>;
}

export function ApiKeysTable({ keys }: ApiKeysTableProps) {
  const revoke = useRevokeApiKey();

  const handleRevoke = (id: string, name: string | null | undefined) => {
    revoke.mutate(id, {
      onSuccess: () =>
        toast.success(`API key ${name ?? id} revoked. Effective within 30s.`),
      onError: (err) => toast.error(err.message),
    });
  };

  const columns: Column<ApiKey>[] = [
    {
      header: "Key",
      cell: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">
            {row.name ?? <span className="text-muted-foreground">Unnamed</span>}
          </span>
          <code className="text-muted-foreground text-[0.7rem]">
            {row.start ?? row.prefix ?? "ek_"}…
          </code>
        </div>
      ),
    },
    {
      header: "Capabilities",
      cell: (row) => <ScopeBadges row={row} />,
    },
    {
      header: "Last used",
      cell: (row) => <LastUsed row={row} />,
    },
    {
      header: "Expires",
      cell: (row) => <Expiry row={row} />,
    },
    {
      header: "Created",
      cell: (row) => (
        <span className="text-muted-foreground">
          {row.createdAt ? formatDate(row.createdAt) : "—"}
        </span>
      ),
    },
    {
      header: <span className="sr-only">Actions</span>,
      cell: (row) => (
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
            Revoke
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Revoke “{row.name ?? "this key"}”?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Any service still using this key will start receiving 401s
                within ~30 seconds. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => handleRevoke(row.id, row.name)}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                Revoke key
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
