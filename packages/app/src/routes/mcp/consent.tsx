import { Button } from "@everr/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";
import {
  Eye,
  Loader2,
  type LucideIcon,
  RefreshCw,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { useState } from "react";
import { submitMcpConsent } from "@/data/mcp-oauth";
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
  // Pass through every search param untouched (see select-org): the full signed
  // query string is replayed to /oauth2/consent as oauth_query.
  validateSearch: (s: Record<string, unknown>) => s,
  component: Consent,
});

function Consent() {
  const search = Route.useSearch() as { client_id?: string; scope?: string };
  const clientId = search.client_id ?? "";
  const scope = search.scope ?? "";
  const scopes = scope.split(/\s+/).filter(Boolean);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      footer="Queries run against your active organization. Revoke access anytime from your Everr settings."
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
