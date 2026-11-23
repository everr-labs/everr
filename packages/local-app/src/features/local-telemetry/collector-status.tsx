import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { invokeCommand } from "@/lib/local-api";

type CollectorStatus = "starting" | "running" | "failed" | "stopped";

type CollectorStatusResponse = {
  status: CollectorStatus;
  reason?: string;
  otlpEndpoint: string;
  sqlEndpoint: string;
  healthEndpoint: string;
  telemetryDir?: string;
};

const collectorStatusQueryKey = ["local-app", "collector-status"] as const;

/**
 * Route loaders run outside the gate, so one that ran while the collector was
 * down has failed. When the collector comes up they run again, so the page
 * recovers without a reload. The first status counts as coming up: a loader
 * can fail just before the collector is ready and the status is first read.
 */
function useRerunFailedLoadersWhenRunning() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return (next: CollectorStatusResponse) => {
    const previous = queryClient.getQueryData<CollectorStatusResponse>(collectorStatusQueryKey);
    if (next.status === "running" && previous?.status !== "running") {
      void router.invalidate({ filter: (match) => match.status === "error" });
    }
  };
}

export function useCollectorStatusQuery() {
  const rerunFailedLoaders = useRerunFailedLoadersWhenRunning();
  return useQuery({
    queryKey: collectorStatusQueryKey,
    refetchInterval: 10_000,
    queryFn: async () => {
      const status = await invokeCommand<CollectorStatusResponse>("get_collector_status");
      rerunFailedLoaders(status);
      return status;
    },
  });
}

export function useRestartCollectorMutation() {
  const queryClient = useQueryClient();
  const rerunFailedLoaders = useRerunFailedLoadersWhenRunning();

  return useMutation({
    mutationFn: () => invokeCommand<CollectorStatusResponse>("restart_collector"),
    onSuccess: (status) => {
      rerunFailedLoaders(status);
      queryClient.setQueryData(collectorStatusQueryKey, status);
      if (status.status === "running") {
        void queryClient.invalidateQueries();
      }
    },
  });
}

export function LocalTelemetryGate({ children }: { children: ReactNode }) {
  const statusQuery = useCollectorStatusQuery();
  const restartMutation = useRestartCollectorMutation();
  const status = statusQuery.data;

  if (status?.status === "running") {
    return children;
  }

  if (status?.status === "starting" || statusQuery.isPending) {
    return (
      <LocalTelemetryState
        title="Starting local telemetry"
        description="The local collector is starting."
      />
    );
  }

  return (
    <LocalTelemetryState
      title="Local telemetry unavailable"
      description={
        status?.reason || statusQuery.error?.message || "The local collector is not running."
      }
      action={
        <Button
          type="button"
          variant="outline"
          disabled={restartMutation.isPending}
          onClick={() => restartMutation.mutate()}
        >
          <RotateCw data-icon="inline-start" />
          {restartMutation.isPending ? "Restarting" : "Restart collector"}
        </Button>
      }
    />
  );
}

function LocalTelemetryState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Empty className="min-h-96 border-0">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}
