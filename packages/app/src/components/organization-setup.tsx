import { Button, buttonVariants } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouteContext, useRouter } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { CLICKHOUSE_SETUP_MESSAGE } from "@/common/clickhouse-provisioning";
import { getActiveOrganization } from "@/data/auth";
import { authClient } from "@/lib/auth-client";

export function OrganizationSetup() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useRouteContext({ from: "/_authenticated" });
  const organizations = authClient.useListOrganizations();
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const status = useQuery({
    queryKey: [
      "organization-provisioning",
      session.session.activeOrganizationId,
    ],
    queryFn: () => getActiveOrganization(),
    refetchInterval: 3000,
    staleTime: 0,
  });

  useEffect(() => {
    if (status.isSuccess && (!status.data || status.data.clickhouseReady)) {
      void router.invalidate();
    }
  }, [status.isSuccess, status.data, router]);

  async function switchOrganization(organizationId: string) {
    setSwitching(true);
    setSwitchError(null);
    try {
      const { error } = await authClient.organization.setActive({
        organizationId,
      });
      if (error)
        throw new Error(error.message ?? "Could not switch organization.");
      await queryClient.invalidateQueries();
      await router.invalidate();
    } catch (error) {
      setSwitchError(
        error instanceof Error
          ? error.message
          : "Could not switch organization.",
      );
    } finally {
      setSwitching(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Loader2
            className="mb-2 size-6 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
          <CardTitle>Getting your organization ready</CardTitle>
          <CardDescription role="status">
            {CLICKHOUSE_SETUP_MESSAGE}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This page will update automatically when your data access is ready.
          </p>
          {status.isError && (
            <p role="alert" className="text-sm text-destructive">
              We couldn't check your setup status. We'll try again
              automatically.
            </p>
          )}
          {organizations.data
            ?.filter((org) => org.id !== status.data?.id)
            .map((org) => (
              <Button
                key={org.id}
                variant="outline"
                className="w-full"
                disabled={switching}
                onClick={() => void switchOrganization(org.id)}
              >
                Switch to {org.name}
              </Button>
            ))}
          {switchError && (
            <p role="alert" className="text-sm text-destructive">
              {switchError}
            </p>
          )}
          <Link
            to="/account"
            className={buttonVariants({
              variant: "outline",
              className: "w-full",
            })}
          >
            Account settings
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
