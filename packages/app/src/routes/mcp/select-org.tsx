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
import { selectMcpOrganization } from "@/data/mcp-oauth";

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

    try {
      const resumed = await selectMcpOrganization({
        data: { organizationId, oauth_query },
      });
      window.location.href = resumed.url;
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Failed to select organization",
      );
      setBusy(false);
    }
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
