import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { COLLECTOR_CHANGED_EVENT, invokeCommand } from "@/lib/tauri";
import { useInvalidateOnTauriEvent } from "@/lib/tauri-events";

type CollectorStatus = "starting" | "running" | "failed" | "stopped";

type CollectorStatusResponse = {
  status: CollectorStatus;
  reason?: string;
  otlpEndpoint: string;
  sqlEndpoint: string;
  healthEndpoint: string;
  telemetryDir?: string;
};

const collectorStatusQueryKey = ["desktop-app", "collector-status"] as const;

export function useCollectorStatusQuery() {
  useInvalidateOnTauriEvent(COLLECTOR_CHANGED_EVENT, (queryClient) => {
    void queryClient.invalidateQueries({ queryKey: collectorStatusQueryKey });
  });

  return useQuery({
    queryKey: collectorStatusQueryKey,
    queryFn: () => invokeCommand<CollectorStatusResponse>("get_collector_status"),
  });
}

export function useRestartCollectorMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => invokeCommand<CollectorStatusResponse>("restart_collector"),
    onSuccess: (status) => {
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
