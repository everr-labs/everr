import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getSqlApiOrgUserSetup,
  retrySqlApiOrgUserSetup,
} from "@/data/sql-api-provision";

export const Route = createFileRoute("/_authenticated/setting-up")({
  head: () => ({ meta: [{ title: "Everr - Setting up your account" }] }),
  loader: async ({ context }) => {
    if (!context.session?.session.activeOrganizationId) {
      throw redirect({ to: "/" });
    }
    const setup = await getSqlApiOrgUserSetup();
    if (setup.status === "ready") {
      throw redirect({ to: "/" });
    }
    return setup;
  },
  component: SettingUpPage,
});

function SettingUpPage() {
  const navigate = useNavigate();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const setup = useQuery({
    queryKey: ["sql-api-org-user-setup"],
    queryFn: () => getSqlApiOrgUserSetup(),
    refetchInterval: (query) => {
      const current = query.state.data?.status;
      if (current === "failed" || current === "ready") return false;
      return 2_000;
    },
  });

  const status = setup.data?.status ?? "pending";

  useEffect(() => {
    if (status !== "ready") return;
    void navigate({ to: "/", replace: true });
  }, [navigate, status]);

  async function retry() {
    setRetryError(null);
    setRetrying(true);
    try {
      await retrySqlApiOrgUserSetup();
      await setup.refetch();
    } catch (error) {
      setRetryError(
        error instanceof Error
          ? error.message
          : "Setup could not be started again.",
      );
    } finally {
      setRetrying(false);
    }
  }

  const failed = status === "failed";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          {failed ? null : (
            <Loader2 className="size-10 animate-spin text-primary" />
          )}
          <CardTitle>
            {failed
              ? "We couldn't finish setting up your account."
              : "We're finishing setting up your account."}
          </CardTitle>
          <CardDescription>
            {failed
              ? "Setup did not succeed after several attempts."
              : "You can leave this page open. It will continue into the app when setup finishes."}
          </CardDescription>
        </CardHeader>
        {setup.error ? (
          <CardContent>
            <p role="alert" className="text-sm text-destructive">
              {setup.error instanceof Error
                ? setup.error.message
                : "Setup status could not be loaded."}
            </p>
          </CardContent>
        ) : null}
        {failed ? (
          <CardContent className="space-y-3">
            {retryError ? (
              <p role="alert" className="text-sm text-destructive">
                {retryError}
              </p>
            ) : null}
            <Button
              className="w-full"
              disabled={retrying}
              onClick={() => void retry()}
            >
              {retrying ? <Loader2 className="animate-spin" /> : null}
              Try again
            </Button>
          </CardContent>
        ) : null}
      </Card>
    </main>
  );
}
