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
import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { RetryError } from "@everr/ui/components/retry-error";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type McpConnection, revokeMcpConnection } from "#app/data/mcp/connections.ts";
import type { RedirectDestination } from "#app/lib/mcp-redirect-uri.ts";
import { MCP_SCOPE_LABELS } from "#app/lib/mcp-scopes.ts";
import { mcpConnectionsQueryOptions } from "./queries";

const MCP_DOCS = "https://everr.dev/docs/reference/mcp";

function destinationText(destination: RedirectDestination | null) {
  if (!destination) return "Unknown destination";
  return destination.kind === "this-computer"
    ? `An app on this computer (${destination.address})`
    : destination.address;
}

export function McpConnectionsSettings({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const options = mcpConnectionsQueryOptions(userId);
  const connections = useQuery(options);
  const revoke = useMutation({
    mutationFn: (consentId: string) => revokeMcpConnection({ data: { consentId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: options.queryKey });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected MCP clients</CardTitle>
        <CardDescription>
          AI clients that can query your telemetry. Revoking one cuts off its access right away.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {connections.isPending && (
          <output className="block text-sm text-muted-foreground">
            Loading connected clients...
          </output>
        )}
        {connections.isError && (
          <RetryError
            variant="inline"
            title="Could not load connected clients"
            message={connections.error.message}
            onRetry={() => void connections.refetch()}
          />
        )}
        {connections.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No MCP clients are connected.{" "}
            <a className="text-primary underline underline-offset-4" href={MCP_DOCS}>
              Connect an AI client
            </a>
          </p>
        )}
        {connections.data && connections.data.length > 0 && (
          <ul className="divide-y">
            {connections.data.map((connection) => (
              <ConnectionRow
                key={connection.consentId}
                connection={connection}
                revoking={revoke.isPending}
                onRevoke={() => revoke.mutate(connection.consentId)}
              />
            ))}
          </ul>
        )}
        {revoke.error && (
          <p role="alert" className="text-sm text-destructive">
            {revoke.error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectionRow({
  connection,
  revoking,
  onRevoke,
}: {
  connection: McpConnection;
  revoking: boolean;
  onRevoke: () => void;
}) {
  const name = connection.clientName || "MCP client";
  const scopes = connection.scopes
    .map((scope) => MCP_SCOPE_LABELS[scope]?.label ?? scope)
    .join(", ");
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="break-all text-sm">
          {name}
          <span className="text-muted-foreground">
            {" "}
            · {destinationText(connection.destination)}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          {connection.organization?.name ?? "No organization"}
          {` · ${scopes}`}
          {connection.connectedAt && (
            <>
              {" · Connected "}
              <time dateTime={new Date(connection.connectedAt).toISOString()}>
                {new Date(connection.connectedAt).toLocaleString()}
              </time>
            </>
          )}
        </p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={revoking}
            />
          }
        >
          Revoke
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It loses access to {connection.organization?.name ?? "Everr"} now. To use it again,
              connect it again from the client.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onRevoke}>
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
