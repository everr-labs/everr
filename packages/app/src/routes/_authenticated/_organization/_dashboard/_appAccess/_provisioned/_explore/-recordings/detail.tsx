import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { Skeleton } from "@everr/ui/components/skeleton";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { lazy, Suspense } from "react";
import { recordingOptions } from "#app/data/recordings/options.ts";
import { remoteRecordingsRepo } from "#app/data/recordings/remote-repo.ts";
import { recordingTitle, triggerLabel } from "./format";
import type { RecordingsSearch } from "./search";

const RecordingPlayer = lazy(() =>
  import("./player").then((mod) => ({ default: mod.RecordingPlayer })),
);

export function RecordingDetail({
  clipId,
  search,
  onBack,
}: {
  clipId: string;
  search: RecordingsSearch;
  onBack?: () => void;
}) {
  const { timeRange, refresh } = withTimeRange(search);
  const { service = [], environment = [] } = useSearch({
    from: "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore",
  });
  const clipQuery = useQuery(
    recordingOptions(remoteRecordingsRepo, {
      clipId,
      timeRange,
      refresh: refresh ?? "off",
      service,
      environment,
    }),
  );

  if (clipQuery.isPending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="min-h-0 flex-1" />
      </div>
    );
  }

  if (clipQuery.isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <DetailBar title="Recording" onBack={onBack} />
        <Empty className="min-h-60 border-0">
          <EmptyHeader>
            <EmptyTitle>Failed to load recording</EmptyTitle>
            <EmptyDescription>Refresh the page and try again.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" variant="outline" onClick={() => void clipQuery.refetch()}>
              <RefreshCw data-icon="inline-start" />
              Retry
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  if (!clipQuery.data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <DetailBar title="Recording" onBack={onBack} />
        <Empty className="min-h-60 border-0">
          <EmptyHeader>
            <EmptyTitle>Recording not found</EmptyTitle>
            <EmptyDescription>This Clip is outside the selected time range.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const clip = clipQuery.data;
  const trigger = triggerLabel(clip.trigger);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DetailBar title={recordingTitle(clip)} onBack={onBack} />
      <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 border-b px-4 py-2 text-xs">
        <Badge variant="outline">{clip.serviceName || "unknown service"}</Badge>
        {trigger ? <Badge variant="secondary">{trigger}</Badge> : null}
        <span title={`${clip.startedAt} to ${clip.endedAt}`}>
          {formatRelativeTime(clip.endedAt)}
        </span>
        {clip.sessionId ? (
          <span className="max-w-56 truncate font-mono" title={clip.sessionId}>
            {clip.sessionId}
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 p-4">
        <Suspense fallback={<Skeleton className="h-full min-h-40" />}>
          <RecordingPlayer clipId={clip.clipId} segments={clip.segments} />
        </Suspense>
      </div>
    </div>
  );
}

function DetailBar({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <header className="flex min-w-0 items-center gap-2 border-b px-3 py-2">
      {onBack ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Back to recordings"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
      ) : null}
      <h1 className="min-w-0 truncate text-sm font-medium">{title}</h1>
    </header>
  );
}
