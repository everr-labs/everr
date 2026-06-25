import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { createFileRoute } from "@tanstack/react-router";
import { Building2, ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { selectMcpOrganization } from "@/data/mcp-oauth";
import { authClient } from "@/lib/auth-client";
import { OAuthShell } from "./-components/oauth-shell";

export const Route = createFileRoute("/mcp/select-org")({
  // Pass through every search param untouched: the authorize redirect lands here
  // with all the signed OAuth params (client_id, code_challenge, sig, ...) inline,
  // and we forward that whole query string back to /oauth2/continue as oauth_query.
  validateSearch: (s: Record<string, unknown>) => s,
  loader: async () => {
    const { data } = await authClient.organization.list();
    return { organizations: data ?? [] };
  },
  component: SelectOrg,
});

function SelectOrg() {
  const { organizations } = Route.useLoaderData();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = pendingId !== null;

  async function choose(organizationId: string) {
    setPendingId(organizationId);
    setError(null);

    // The signed OAuth params arrived as this page's query string; replay them.
    const oauth_query = window.location.search.replace(/^\?/, "");
    try {
      const { url } = await selectMcpOrganization({
        data: { organizationId, oauth_query },
      });
      window.location.href = url;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Failed to select organization",
      );
      setPendingId(null);
    }
  }

  return (
    <OAuthShell
      title="Choose an organization"
      description="Connect this MCP client to one organization's telemetry."
      footer="Read-only access. Revoke it anytime from your Everr settings."
    >
      {organizations.length === 0 ? (
        <Empty className="border-0 py-2">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2 />
            </EmptyMedia>
            <EmptyTitle>No organizations</EmptyTitle>
            <EmptyDescription>
              You don't belong to any organization yet. Create one in Everr,
              then reconnect this client.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {organizations.map((org) => {
            const pending = pendingId === org.id;
            return (
              <li key={org.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => choose(org.id)}
                  className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/15 font-heading text-sm font-semibold text-primary">
                    {org.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {org.name}
                  </span>
                  {pending ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-disabled:opacity-0" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </OAuthShell>
  );
}
