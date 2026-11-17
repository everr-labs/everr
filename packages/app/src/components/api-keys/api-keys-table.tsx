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
import { CopyStateContent } from "@everr/ui/components/copy-state-icon";
import { Popover, PopoverContent, PopoverTrigger } from "@everr/ui/components/popover";
import { Toggletip, ToggletipContent, ToggletipTrigger } from "@everr/ui/components/toggletip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@everr/ui/components/tooltip";
import { useCopyToClipboard } from "@everr/ui/hooks/use-copy-to-clipboard";
import { Globe, KeyRound, type LucideIcon } from "lucide-react";
import { progressToast } from "#app/lib/progress-toast.ts";
import { CreateApiKeyDialog } from "#app/components/api-keys/create-api-key-dialog.tsx";
import { formatDate } from "#app/components/users-management/format-date.ts";
import {
  API_KEY_SCOPES,
  type ApiKeyPermissions,
  describeApiKeyScopes,
} from "#app/lib/api-key-scopes.ts";
import { publicKeyMetadataOf } from "#app/lib/public-ingest-keys.ts";
import { type ApiKey, useRevokeApiKey } from "./queries";
import { SCOPE_ICONS } from "./scope-meta";

type RevokeFn = (row: ApiKey) => void;

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

// The key's name plus its masked prefix. The section a row sits in already
// says whether it's a public key, so the row doesn't repeat it.
function KeyIdentity({ row }: { row: ApiKey }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate font-medium">
        {row.name ?? <span className="text-muted-foreground">Unnamed</span>}
      </span>
      {row.fullKey === undefined ? (
        <code className="text-muted-foreground text-[0.7rem]">{maskedKey(row)}</code>
      ) : (
        <RevealKey name={row.name} masked={maskedKey(row)} fullKey={row.fullKey} />
      )}
    </div>
  );
}

const maskedKey = (row: ApiKey) => `${row.start ?? row.prefix ?? "ek_"}…`;

// A public key ships in page source, so its masked prefix opens the whole
// key, ready to select or copy.
function RevealKey({
  name,
  masked,
  fullKey,
}: {
  name: ApiKey["name"];
  masked: string;
  fullKey: string;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Show the full key for ${name ?? "this key"}`}
        className="text-muted-foreground hover:text-foreground w-fit cursor-pointer text-left font-mono text-[0.7rem] underline decoration-dotted underline-offset-2 transition-colors"
      >
        {masked}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[26rem] gap-2.5 p-3">
        <code className="bg-muted/40 rounded-md border px-2.5 py-2 font-mono text-xs/relaxed break-all select-all">
          {fullKey}
        </code>
        <div className="flex justify-end">
          <CopyKeyButton fullKey={fullKey} variant="outline" />
        </div>
      </PopoverContent>
    </Popover>
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
            <TooltipTrigger render={<Badge variant="outline" className="gap-1" />}>
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

// Allowed origins for a public key: the first two inline, and a "+N" that
// opens the full list. A long origin is cut short in the row, so each chip
// also carries its full text.
function AllowedOrigins({ row }: { row: ApiKey }) {
  const origins = publicKeyMetadataOf(row.metadata)?.allowedOrigins ?? [];
  if (origins.length === 0) {
    return <span className="text-muted-foreground">None</span>;
  }
  const rest = origins.length - 2;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {origins.slice(0, 2).map((origin) => (
        <code
          key={origin}
          title={origin}
          className="bg-muted/40 text-muted-foreground max-w-[9rem] truncate rounded border px-1.5 py-0.5 font-mono text-[0.7rem] xl:max-w-[13rem]"
        >
          {origin}
        </code>
      ))}
      {rest > 0 && (
        <Popover>
          <PopoverTrigger
            aria-label={`Show all ${origins.length} allowed origins`}
            className="text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer rounded px-1 text-xs transition-colors"
          >
            +{rest}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto max-w-sm gap-2 p-3">
            <p className="text-muted-foreground font-medium">Allowed origins ({origins.length})</p>
            <ul className="space-y-1 font-mono text-xs/relaxed">
              {origins.map((origin) => (
                <li key={origin} className="break-all select-all">
                  {origin}
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function LastUsed({ row }: { row: ApiKey }) {
  const value = row.lastRequest;
  const relative = relativeFromNow(value);
  if (!relative || !value) {
    return <span className="text-muted-foreground whitespace-nowrap">Never used</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="cursor-default whitespace-nowrap" />}>
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
        <TooltipTrigger render={<span className="text-destructive cursor-default font-medium" />}>
          Expired
        </TooltipTrigger>
        <TooltipContent>{exactDate(value)}</TooltipContent>
      </Tooltip>
    );
  }
  return <span className="whitespace-nowrap">{formatDate(value)}</span>;
}

function Created({ row }: { row: ApiKey }) {
  return (
    <span className="text-muted-foreground whitespace-nowrap">
      {row.createdAt ? formatDate(row.createdAt) : "Unknown"}
    </span>
  );
}

// Public keys created before keys were stored unhashed can't be shown again,
// so their row says why instead of offering a copy that can't work.
function CopyPublicKey({ row }: { row: ApiKey }) {
  if (row.fullKey === undefined) {
    return (
      <Toggletip>
        <ToggletipTrigger className="text-muted-foreground cursor-help text-xs">
          Not copyable
        </ToggletipTrigger>
        <ToggletipContent className="max-w-64">
          This key was created before public keys could be shown again. Create a new public key to
          get one you can see and copy at any time.
        </ToggletipContent>
      </Toggletip>
    );
  }
  // Icon only below xl, where the public table runs out of width.
  return <CopyKeyButton fullKey={row.fullKey} labelClassName="sr-only xl:not-sr-only" />;
}

function CopyKeyButton({
  fullKey,
  variant = "ghost",
  labelClassName,
}: {
  fullKey: string;
  variant?: "ghost" | "outline";
  labelClassName?: string;
}) {
  const { state, copy } = useCopyToClipboard(fullKey);
  return (
    <Button variant={variant} size="sm" onClick={copy}>
      <CopyStateContent
        copied={state === "copied"}
        label={state === "failed" ? "Copy failed" : "Copy key"}
        labelClassName={labelClassName}
      />
    </Button>
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
          <AlertDialogTitle>Revoke “{row.name ?? "this key"}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Any {audience} still using this key will start getting 401s within about 30 seconds.
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => onRevoke(row)}>
            Revoke key
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---- Tables --------------------------------------------------------------

// Both tables share these widths so Last used, Expires and Created line up
// from one section to the next; the second column takes the rest. Narrower
// than xl there isn't room to spare, so the tables size to their content.
// A header class replaces DataTable's default padding, so it is restated.
const WIDTH = {
  key: "pb-2 pr-4 pl-3 xl:w-40",
  lastUsed: "pb-2 pr-4 xl:w-36",
  expires: "pb-2 pr-4 xl:w-24",
  created: "pb-2 pr-4 xl:w-28",
  actions: "pb-2 pr-3 xl:w-40",
} as const;

// Both tables: Key, one column that differs, the shared dates, then actions.
function keyColumns(middle: Column<ApiKey>, actions: Column<ApiKey>["cell"]): Column<ApiKey>[] {
  return [
    { header: "Key", cell: (row) => <KeyIdentity row={row} />, className: WIDTH.key },
    middle,
    { header: "Last used", cell: (row) => <LastUsed row={row} />, className: WIDTH.lastUsed },
    { header: "Expires", cell: (row) => <Expiry row={row} />, className: WIDTH.expires },
    { header: "Created", cell: (row) => <Created row={row} />, className: WIDTH.created },
    {
      header: <span className="sr-only">Actions</span>,
      cell: (row) => (
        <div className="flex items-center justify-end gap-1 whitespace-nowrap">{actions(row)}</div>
      ),
      cellClassName: "py-2 pr-3 text-right",
      className: WIDTH.actions,
    },
  ];
}

function secretColumns(onRevoke: RevokeFn): Column<ApiKey>[] {
  return keyColumns({ header: "Capabilities", cell: (row) => <ScopeBadges row={row} /> }, (row) => (
    <RevokeAction row={row} kind="secret" onRevoke={onRevoke} />
  ));
}

function publicColumns(onRevoke: RevokeFn): Column<ApiKey>[] {
  return keyColumns(
    { header: "Allowed origins", cell: (row) => <AllowedOrigins row={row} /> },
    (row) => (
      <>
        <CopyPublicKey row={row} />
        <RevokeAction row={row} kind="public" onRevoke={onRevoke} />
      </>
    ),
  );
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

  const handleRevoke: RevokeFn = (row) => {
    const label = row.name ?? row.id;
    const progress = progressToast(`Revoking API key ${label}…`);
    revoke.mutate(row, {
      onSuccess: () => progress.success(`API key ${label} revoked. Effective within 30s.`),
      onError: (err) => progress.error(err.message),
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
              animateRows
            />
          ) : (
            <SectionEmpty icon={KeyRound} title="No organization keys yet">
              Create one to send OpenTelemetry data from servers, CLIs, and collectors, or to manage
              dashboards, runbooks, and alerts with{" "}
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
              Safe to put in a web page. A public key can only send telemetry, and only from the
              browser origins you allow. It can&apos;t read data or run{" "}
              <code className="font-mono text-xs">everr apply</code>.
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
                animateRows
              />
            ) : (
              <SectionEmpty icon={Globe} title="No public keys yet">
                Create one to send telemetry straight from a web page: page views, web vitals, and
                front-end errors.
              </SectionEmpty>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
