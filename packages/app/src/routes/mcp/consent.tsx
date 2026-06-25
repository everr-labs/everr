import { Button } from "@everr/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@everr/ui/components/popover";
import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  Eye,
  Loader2,
  type LucideIcon,
  RefreshCw,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { useState } from "react";
import { setActiveMcpOrganization, submitMcpConsent } from "@/data/mcp-oauth";
import { authClient } from "@/lib/auth-client";
import { OAuthShell } from "./-components/oauth-shell";

// Human-readable rendering for the scopes an MCP client can request. Unknown
// scopes fall back to the raw value so consent never hides what's granted.
const SCOPE_LABELS: Record<
  string,
  { icon: LucideIcon; label: string; description: string }
> = {
  "observability:read": {
    icon: Eye,
    label: "Read your telemetry",
    description:
      "Run read-only queries against your organization's traces, logs, and metrics.",
  },
  offline_access: {
    icon: RefreshCw,
    label: "Stay connected",
    description: "Refresh access without you signing in again.",
  },
};

export const Route = createFileRoute("/mcp/consent")({
  // Pass through every search param untouched: the authorize redirect lands here
  // with all the signed OAuth params inline, and the whole query string is
  // replayed to /oauth2/consent as oauth_query.
  validateSearch: (s: Record<string, unknown>) => s,
  loader: async () => {
    const [orgs, session] = await Promise.all([
      authClient.organization.list(),
      authClient.getSession(),
    ]);
    return {
      organizations: orgs.data ?? [],
      activeOrganizationId: session.data?.session.activeOrganizationId ?? null,
    };
  },
  component: Consent,
});

function Consent() {
  const { organizations, activeOrganizationId } = Route.useLoaderData();
  const search = Route.useSearch() as { client_id?: string; scope?: string };
  const clientId = search.client_id ?? "";
  const scope = search.scope ?? "";
  const scopes = scope.split(/\s+/).filter(Boolean);

  // The org bound at Approve is whatever is server-side active; switching is just
  // set-active beforehand, so we track the chosen id and mirror it for display.
  const [activeId, setActiveId] = useState<string | null>(
    activeOrganizationId ?? organizations[0]?.id ?? null,
  );
  const [switchOpen, setSwitchOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeOrg = organizations.find((o) => o.id === activeId) ?? null;
  const canSwitch = organizations.length > 1;

  async function switchOrg(organizationId: string) {
    if (organizationId === activeId) {
      setSwitchOpen(false);
      return;
    }
    setSwitchingId(organizationId);
    setError(null);
    try {
      await setActiveMcpOrganization({ data: { organizationId } });
      setActiveId(organizationId);
      setSwitchOpen(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Failed to switch organization",
      );
    } finally {
      setSwitchingId(null);
    }
  }

  async function decide(accept: boolean) {
    setBusy(accept ? "approve" : "deny");
    setError(null);

    // The signed OAuth params arrived as this page's query string; replay them.
    const oauth_query = window.location.search.replace(/^\?/, "");
    try {
      const { url } = await submitMcpConsent({
        data: { accept, scope, oauth_query },
      });
      window.location.href = url;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Failed to record consent",
      );
      setBusy(null);
    }
  }

  return (
    <OAuthShell
      title="Authorize access"
      description="Review what this client can do before you approve."
    >
      <div className="flex items-center gap-3 rounded-lg bg-accent/60 px-3 py-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Terminal className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">MCP client</p>
          {clientId ? (
            <p
              className="truncate font-mono text-xs text-muted-foreground"
              title={clientId}
            >
              {clientId}
            </p>
          ) : null}
        </div>
      </div>

      <ul className="mt-4 flex flex-col gap-3.5">
        {(scopes.length > 0 ? scopes : ["observability:read"]).map((value) => {
          const meta = SCOPE_LABELS[value];
          const Icon = meta?.icon ?? ShieldCheck;
          return (
            <li key={value} className="flex gap-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {meta?.label ?? value}
                </p>
                {meta ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {meta.description}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {activeOrg ? (
        <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/15 font-heading text-sm font-semibold text-primary">
            {activeOrg.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Organization</p>
            <p className="truncate text-sm font-medium text-foreground">
              {activeOrg.name}
            </p>
          </div>
          {canSwitch ? (
            <Popover open={switchOpen} onOpenChange={setSwitchOpen}>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                  />
                }
              >
                Switch
              </PopoverTrigger>
              <PopoverContent align="end" className="w-60 p-1">
                <ul className="flex flex-col gap-0.5">
                  {organizations.map((org) => {
                    const switching = switchingId === org.id;
                    const isActive = org.id === activeId;
                    return (
                      <li key={org.id}>
                        <button
                          type="button"
                          disabled={switchingId !== null}
                          onClick={() => switchOrg(org.id)}
                          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                        >
                          <span className="flex size-7 shrink-0 items-center justify-center rounded bg-primary/15 font-heading text-xs font-semibold text-primary">
                            {org.name.charAt(0).toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                            {org.name}
                          </span>
                          {switching ? (
                            <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                          ) : isActive ? (
                            <Check className="size-4 shrink-0 text-primary" />
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="flex-1"
          disabled={busy !== null}
          onClick={() => decide(false)}
        >
          {busy === "deny" ? <Loader2 className="animate-spin" /> : null}
          Deny
        </Button>
        <Button
          type="button"
          size="lg"
          className="flex-1"
          disabled={busy !== null}
          onClick={() => decide(true)}
        >
          {busy === "approve" ? <Loader2 className="animate-spin" /> : null}
          Approve
        </Button>
      </div>
    </OAuthShell>
  );
}
