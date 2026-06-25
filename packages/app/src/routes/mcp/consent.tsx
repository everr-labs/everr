import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { submitMcpConsent } from "@/data/mcp-oauth";

export const Route = createFileRoute("/mcp/consent")({
  // Pass through every search param untouched (see select-org): the full signed
  // query string is replayed to /oauth2/consent as oauth_query.
  validateSearch: (s: Record<string, unknown>) => s,
  component: Consent,
});

function Consent() {
  const search = Route.useSearch() as { client_id?: string; scope?: string };
  const client_id = search.client_id ?? "";
  const scope = search.scope ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(accept: boolean) {
    setBusy(true);
    setError(null);

    // The signed OAuth params arrived as this page's query string; replay them.
    const oauth_query = window.location.search.replace(/^\?/, "");
    try {
      const { url } = await submitMcpConsent({
        data: { accept, scope, oauth_query },
      });
      window.location.href = url;
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to record consent",
      );
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto mt-16 w-full max-w-md px-4">
      <Card>
        <CardHeader>
          <CardTitle>Authorize MCP access</CardTitle>
          <CardDescription>
            <code>{client_id}</code> is requesting access to{" "}
            <code>{scope}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Approving lets this client query your active organization's
            telemetry on your behalf.
          </p>
          {error ? (
            <p className="text-destructive mt-2 text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => decide(false)}
          >
            Deny
          </Button>
          <Button type="button" disabled={busy} onClick={() => decide(true)}>
            Approve
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
