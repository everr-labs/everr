import { Card, CardContent } from "@everr/ui/components/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { KeyRound } from "lucide-react";
import { ApiKeysTable } from "@/components/api-keys/api-keys-table";
import { CreateApiKeyDialog } from "@/components/api-keys/create-api-key-dialog";
import { apiKeysQueryOptions } from "@/components/api-keys/queries";
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

export const Route = createFileRoute("/_authenticated/_dashboard/api-keys")({
  staticData: { breadcrumb: "API keys", hideTimeRangePicker: true },
  head: () => ({
    meta: [{ title: "Everr - API keys" }],
  }),
  beforeLoad: async () => {
    const { allowed } = await ensureOrgAdmin();
    if (!allowed) {
      throw redirect({ to: "/" });
    }
  },
  component: ApiKeysPage,
});

function KeysSkeleton() {
  return (
    <div className="space-y-2 px-3 py-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

function ApiKeysEmpty() {
  return (
    <Empty className="border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <KeyRound />
        </EmptyMedia>
        <EmptyTitle>No API keys yet</EmptyTitle>
        <EmptyDescription>
          Create a key to send OpenTelemetry data to Everr or to manage
          dashboards, notebooks, and alerts with <code>everr apply</code>.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <CreateApiKeyDialog />
      </EmptyContent>
    </Empty>
  );
}

function ApiKeysPage() {
  const keys = useQuery(apiKeysQueryOptions());
  const isEmpty = !keys.isPending && (keys.data?.length ?? 0) === 0;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight">API keys</h1>
          <p className="text-muted-foreground max-w-prose text-sm/relaxed">
            Organization-scoped keys for sending telemetry to Everr and running{" "}
            <code className="font-mono text-xs">everr apply</code>. Choose each
            key's capabilities when you create it.{" "}
            <a
              className="text-foreground underline underline-offset-4 hover:text-primary"
              href="https://everr.dev/docs/production-monitoring/setup"
              target="_blank"
              rel="noreferrer"
            >
              SDK setup
            </a>
          </p>
        </div>
        {!isEmpty && <CreateApiKeyDialog />}
      </div>

      <Card inset="flush-content">
        <CardContent>
          {keys.isPending ? (
            <KeysSkeleton />
          ) : isEmpty ? (
            <ApiKeysEmpty />
          ) : (
            <ApiKeysTable keys={keys.data ?? []} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
