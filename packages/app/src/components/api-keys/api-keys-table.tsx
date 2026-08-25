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
import { Card, CardContent } from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@everr/ui/components/empty";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { Globe, KeyRound, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { CreateApiKeyDialog } from "@/components/api-keys/create-api-key-dialog";
import { formatDate } from "@/components/users-management/format-date";
import {
  API_KEY_SCOPES,
  type ApiKeyPermissions,
  describeApiKeyScopes,
} from "@/lib/api-key-scopes";
import { publicKeyMetadataOf } from "@/lib/public-ingest-keys";
import { type ApiKey, useRevokeApiKey } from "./queries";
import { SCOPE_ICONS } from "./scope-meta";

type RevokeFn = (id: string, name: string | null | undefined) => void;

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

// ---- Shared cells --------------------------------------------------------

// The key's name plus its masked prefix. Public (browser) keys also carry a
// globe marker so a row reads as a browser key on its own, not only via the
// section it sits in.
function KeyIdentity({ row, browser }: { row: ApiKey; browser?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {browser && (
        <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-md border">
          <Globe className="size-3.5" />
        </span>
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-medium">
          {row.name ?? <span className="text-muted-foreground">Unnamed</span>}
        </span>
        <code className="text-muted-foreground text-[0.7rem]">
          {row.start ?? row.prefix ?? "ek_"}…
        </code>
      </div>
    </div>
  );
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

// Allowed origins for a public key: the first two inline, the rest folded
// into a "+N" tooltip so a key with many origins doesn't blow out the column.
function AllowedOrigins({ row }: { row: ApiKey }) {
  const origins = publicKeyMetadataOf(row.metadata)?.allowedOrigins ?? [];
  if (origins.length === 0) {
    return <span className="text-muted-foreground">None</span>;
  }
  const shown = origins.slice(0, 2);
  const rest = origins.slice(2);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((origin) => (
        <code
          key={origin}
          className="bg-muted/40 text-muted-foreground max-w-[13rem] truncate rounded border px-1.5 py-0.5 font-mono text-[0.7rem]"
        >
          {origin}
        </code>
      ))}
      {rest.length > 0 && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="text-muted-foreground cursor-default text-xs" />
            }
          >
            +{rest.length}
          </TooltipTrigger>
          <TooltipContent>
            <ul className="font-mono text-xs">
              {rest.map((origin) => (
                <li key={origin}>{origin}</li>
              ))}
            </ul>
          </TooltipContent>
        </Tooltip>
      )}
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

function Created({ row }: { row: ApiKey }) {
  return (
    <span className="text-muted-foreground">
      {row.createdAt ? formatDate(row.createdAt) : "Unknown"}
    </span>
  );
}

// Revoke lives in a confirm dialog. The warning names the audience that will
// break so the consequence is concrete: services for secret keys, web pages
// for public browser keys.
function RevokeAction({
  row,
  kind,
  onRevoke,
}: {
  row: ApiKey;
  kind: "secret" | "public";
  onRevoke: RevokeFn;
}) {
  const audience = kind === "public" ? "web page" : "service";
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
        Revoke
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Revoke “{row.name ?? "this key"}”?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Any {audience} still using this key will start getting 401s within
            about 30 seconds. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onRevoke(row.id, row.name)}
            className="bg-destructive hover:bg-destructive/90 text-white"
          >
            Revoke key
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---- Tables --------------------------------------------------------------

function secretColumns(onRevoke: RevokeFn): Column<ApiKey>[] {
  return [
    { header: "Key", cell: (row) => <KeyIdentity row={row} /> },
    { header: "Capabilities", cell: (row) => <ScopeBadges row={row} /> },
    { header: "Last used", cell: (row) => <LastUsed row={row} /> },
    { header: "Expires", cell: (row) => <Expiry row={row} /> },
    { header: "Created", cell: (row) => <Created row={row} /> },
    {
      header: <span className="sr-only">Actions</span>,
      cell: (row) => (
        <RevokeAction row={row} kind="secret" onRevoke={onRevoke} />
      ),
      cellClassName: "py-2 pr-3 text-right",
      className: "pb-2 pr-3",
    },
  ];
}

function publicColumns(onRevoke: RevokeFn): Column<ApiKey>[] {
  return [
    { header: "Key", cell: (row) => <KeyIdentity row={row} browser /> },
    { header: "Allowed origins", cell: (row) => <AllowedOrigins row={row} /> },
    { header: "Last used", cell: (row) => <LastUsed row={row} /> },
    { header: "Expires", cell: (row) => <Expiry row={row} /> },
    { header: "Created", cell: (row) => <Created row={row} /> },
    {
      header: <span className="sr-only">Actions</span>,
      cell: (row) => (
        <RevokeAction row={row} kind="public" onRevoke={onRevoke} />
      ),
      cellClassName: "py-2 pr-3 text-right",
      className: "pb-2 pr-3",
    },
  ];
}

// A section with no keys still has to say what belongs there and why. The
// button that creates one sits in the section header just above, so the state
// stays a briefing, not a second copy of the same control.
function SectionEmpty({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Empty className="border-0 py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

interface ApiKeysSectionsProps {
  keys: ApiKey[];
}

// The API keys surface, split by type. Secret (organization) keys sit under
// the page heading; public browser keys get their own labelled section with
// type-appropriate columns (allowed origins instead of capabilities), so the
// two read as distinct kinds of key rather than rows sharing one table.
export function ApiKeysSections({ keys }: ApiKeysSectionsProps) {
  const revoke = useRevokeApiKey();

  const handleRevoke: RevokeFn = (id, name) => {
    revoke.mutate(id, {
      onSuccess: () =>
        toast.success(`API key ${name ?? id} revoked. Effective within 30s.`),
      onError: (err) => toast.error(err.message),
    });
  };

  const publicKeys = keys.filter((k) => publicKeyMetadataOf(k.metadata));
  const secretKeys = keys.filter((k) => !publicKeyMetadataOf(k.metadata));

  return (
    <div className="space-y-10">
      <Card inset="flush-content">
        <CardContent>
          {secretKeys.length > 0 ? (
            <DataTable
              data={secretKeys}
              columns={secretColumns(handleRevoke)}
              rowKey={(row) => row.id}
            />
          ) : (
            <SectionEmpty icon={KeyRound} title="No organization keys yet">
              Create one to send OpenTelemetry data from servers, CLIs, and
              collectors, or to manage dashboards, runbooks, and alerts with{" "}
              <code className="font-mono text-[0.7rem]">everr apply</code>.
            </SectionEmpty>
          )}
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <Globe className="text-muted-foreground size-4" />
              Public keys
            </h2>
            <p className="text-muted-foreground max-w-prose text-sm/relaxed">
              Safe to put in a web page. A public key can only send telemetry,
              and only from the browser origins you allow. It can't read data or
              run <code className="font-mono text-xs">everr apply</code>.
            </p>
          </div>
          <CreateApiKeyDialog
            defaultPublic
            triggerLabel="New public key"
            triggerVariant="outline"
          />
        </div>

        <Card inset="flush-content">
          <CardContent>
            {publicKeys.length > 0 ? (
              <DataTable
                data={publicKeys}
                columns={publicColumns(handleRevoke)}
                rowKey={(row) => row.id}
              />
            ) : (
              <SectionEmpty icon={Globe} title="No public keys yet">
                Create one to send telemetry straight from a web page: page
                views, web vitals, and front-end errors.
              </SectionEmpty>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
