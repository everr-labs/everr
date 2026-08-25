import { Card, CardContent } from "@everr/ui/components/card";
import { RetryError } from "@everr/ui/components/retry-error";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { ApiKeysSections } from "@/components/api-keys/api-keys-table";
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

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_padded/api-keys",
)({
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

function ApiKeysPage() {
  const keys = useQuery(apiKeysQueryOptions());

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight">API keys</h1>
          <p className="text-muted-foreground max-w-prose text-sm/relaxed">
            Organization-scoped keys for sending telemetry to Everr and running{" "}
            <code className="font-mono text-xs">everr apply</code>. Choose each
            key's capabilities when you create it.{" "}
            <a
              className="text-foreground hover:text-primary underline underline-offset-4"
              href="https://everr.dev/docs/guides/production-telemetry"
              target="_blank"
              rel="noreferrer"
            >
              SDK setup
            </a>
          </p>
        </div>
        {/* Sits outside every data-dependent branch below. The dialog shows a
            new key exactly once, so a branch swapping under it would drop the
            key before it can be copied. */}
        <CreateApiKeyDialog />
      </div>

      {keys.isPending ? (
        <Card inset="flush-content">
          <CardContent>
            <KeysSkeleton />
          </CardContent>
        </Card>
      ) : keys.isError ? (
        <Card inset="flush-content">
          <CardContent>
            <RetryError
              title="Couldn't load API keys"
              message={
                keys.error instanceof Error
                  ? keys.error.message
                  : "Something went wrong fetching your keys."
              }
              onRetry={() => keys.refetch()}
            />
          </CardContent>
        </Card>
      ) : (
        <ApiKeysSections keys={keys.data ?? []} />
      )}
    </div>
  );
}
