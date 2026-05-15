import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { CreateIngestKeyDialog } from "@/components/ingest-keys/create-ingest-key-dialog";
import { IngestKeysTable } from "@/components/ingest-keys/ingest-keys-table";
import { ingestKeysQueryOptions } from "@/components/ingest-keys/queries";
import { auth } from "@/lib/auth.server";
import { createAuthenticatedServerFn } from "@/lib/serverFn";

const ensureOrgAdmin = createAuthenticatedServerFn.handler(
  async ({ context: { session } }) => {
    const org = await auth.api.getFullOrganization({
      headers: getRequestHeaders(),
      query: { organizationId: session.session.activeOrganizationId },
    });
    if (!org) return { allowed: false };

    const membership = org.members.find((m) => m.userId === session.user.id);
    return {
      allowed: membership?.role === "admin" || membership?.role === "owner",
    };
  },
);

export const Route = createFileRoute("/_authenticated/_dashboard/ingest-keys")({
  staticData: { breadcrumb: "Ingest Keys", hideTimeRangePicker: true },
  head: () => ({
    meta: [{ title: "Everr - Ingest Keys" }],
  }),
  beforeLoad: async () => {
    const { allowed } = await ensureOrgAdmin();
    if (!allowed) {
      throw redirect({ to: "/" });
    }
  },
  component: IngestKeysPage,
});

function KeysSkeleton() {
  return (
    <div className="space-y-2 px-3 py-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

function IngestKeysPage() {
  const keys = useQuery(ingestKeysQueryOptions());

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Ingest Keys</h1>
        <p className="text-muted-foreground">
          Organization-scoped API keys for sending OpenTelemetry data to Everr.
          See{" "}
          <a
            className="underline"
            href="https://everr.dev/docs/sending-telemetry"
            target="_blank"
            rel="noreferrer"
          >
            SDK setup
          </a>
          .
        </p>
      </div>

      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>Active keys</CardTitle>
          <CardAction>
            <CreateIngestKeyDialog />
          </CardAction>
        </CardHeader>
        <CardContent>
          {keys.isPending ? (
            <KeysSkeleton />
          ) : (
            <IngestKeysTable keys={keys.data ?? []} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
