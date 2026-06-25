import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/mcp/consent")({
  validateSearch: (s: Record<string, unknown>) => ({
    client_id: String(s.client_id ?? ""),
    scope: String(s.scope ?? ""),
    oauth_query: typeof s.oauth_query === "string" ? s.oauth_query : "",
  }),
  component: Consent,
});

function Consent() {
  const { client_id, scope, oauth_query } = Route.useSearch();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(accept: boolean) {
    setBusy(true);
    setError(null);

    // The provider returns { redirect, url } and does not auto-follow; navigate
    // to the returned URL (the client's redirect_uri on accept) ourselves.
    const result = await authClient.oauth2.consent({
      accept,
      scope,
      oauth_query,
    });
    if (result.error) {
      setError(result.error.message ?? "Failed to record consent");
      setBusy(false);
      return;
    }
    if (result.data?.url) {
      window.location.href = result.data.url;
      return;
    }
    // No redirect returned (e.g. denied without a redirect): fall back home.
    router.navigate({ to: "/" });
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
