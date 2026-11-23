import { PageHeader, ScrollingPageContainer } from "@everr/ui/components/page-layout";
import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { cn } from "@everr/ui/lib/utils";
import { RotateCw } from "lucide-react";
import {
  useCollectorStatusQuery,
  useRestartCollectorMutation,
} from "../local-telemetry/collector-status";

function LocalTelemetryCard() {
  const statusQuery = useCollectorStatusQuery();
  const restartMutation = useRestartCollectorMutation();
  const status = statusQuery.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Local telemetry</CardTitle>
        <CardDescription>
          Collector status and local endpoints used by Logs, Errors, Traces, and Metrics.
        </CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={restartMutation.isPending}
            onClick={() => restartMutation.mutate()}
          >
            <RotateCw data-icon="inline-start" />
            {restartMutation.isPending ? "Restarting" : "Restart collector"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {statusQuery.isError && (
          <p role="alert" className="text-destructive text-sm">
            Could not read the collector status. Restart the collector to try again.
          </p>
        )}
        <dl className="grid grid-cols-[4.5rem_1fr] items-baseline gap-x-6 gap-y-2.5 text-sm">
          <dt className="text-muted-foreground">Status</dt>
          {/* The dot is a pseudo-element of the text, so the row keeps the text's
              baseline and lines up with its label. */}
          <dd
            className={cn(
              "m-0 font-mono before:mr-2 before:inline-block before:size-1.5 before:rounded-full before:align-middle before:content-['']",
              status?.status === "running" ? "before:bg-success" : "before:bg-warning",
            )}
          >
            {status?.status ?? (statusQuery.isPending ? "loading" : "unknown")}
          </dd>
          {status?.reason ? (
            <>
              <dt className="text-muted-foreground">Reason</dt>
              <dd className="m-0 min-w-0 font-mono wrap-anywhere">{status.reason}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">OTLP</dt>
          <dd className="m-0 min-w-0 font-mono wrap-anywhere">
            {status?.otlpEndpoint ?? "unknown"}
          </dd>
          <dt className="text-muted-foreground">SQL</dt>
          <dd className="m-0 min-w-0 font-mono wrap-anywhere">
            {status?.sqlEndpoint ?? "unknown"}
          </dd>
          <dt className="text-muted-foreground">Health</dt>
          <dd className="m-0 min-w-0 font-mono wrap-anywhere">
            {status?.healthEndpoint ?? "unknown"}
          </dd>
          <dt className="text-muted-foreground">Data</dt>
          <dd className="m-0 min-w-0 font-mono wrap-anywhere">
            {status?.telemetryDir ?? "unknown"}
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  return (
    <ScrollingPageContainer>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
        <PageHeader title="Settings" lede="How this machine collects and stores telemetry." />
        <LocalTelemetryCard />
      </div>
    </ScrollingPageContainer>
  );
}
