import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/mcp/select-org")({
  validateSearch: (s: Record<string, unknown>) => ({
    oauth_query: typeof s.oauth_query === "string" ? s.oauth_query : "",
  }),
  loader: async () => {
    const { data } = await authClient.organization.list();
    return { organizations: data ?? [] };
  },
  component: SelectOrg,
});

function SelectOrg() {
  const { organizations } = Route.useLoaderData();
  const { oauth_query } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(organizationId: string) {
    setBusy(true);
    setError(null);

    // Bind the chosen org to the session before resuming. Separate requests,
    // so await the write before continuing.
    const active = await authClient.organization.setActive({ organizationId });
    if (active.error) {
      setError(active.error.message ?? "Failed to select organization");
      setBusy(false);
      return;
    }

    // Resume the OAuth flow. The provider returns { redirect, url }; it does
    // not auto-follow, so navigate to the returned URL ourselves.
    const resumed = await authClient.oauth2.continue({
      postLogin: true,
      oauth_query,
    });
    if (resumed.error || !resumed.data?.url) {
      setError(resumed.error?.message ?? "Failed to resume authorization");
      setBusy(false);
      return;
    }
    window.location.href = resumed.data.url;
  }

  return (
    <main className="mx-auto mt-16 w-full max-w-md px-4">
      <Card>
        <CardHeader>
          <CardTitle>Choose an organization</CardTitle>
          <CardDescription>
            The MCP client will query this organization's telemetry.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {organizations.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              You don't belong to any organizations.
            </p>
          ) : (
            organizations.map((o) => (
              <Button
                key={o.id}
                type="button"
                variant="outline"
                className="justify-start"
                disabled={busy}
                onClick={() => choose(o.id)}
              >
                {o.name}
              </Button>
            ))
          )}
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
