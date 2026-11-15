import type { ErrorsRepositoryLike, RelatedSpan } from "../errors";
import type { LogsExplorerProps, LogsRepositoryLike } from "../logs";
import type { MetricsRepositoryLike } from "../metrics";
import type { ProfilesRepositoryLike, RuntimeMetricsRepositoryLike } from "../profiles";
import type { SessionRecordingsHost } from "../recordings";
import type { TracesRepositoryLike } from "../traces";
import type { QueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import type { ComponentType, ReactNode } from "react";

/** The spans of one trace, as the error trace panel draws them. */
interface ErrorTraceSpans {
  spans: RelatedSpan[];
  isPending: boolean;
  isError: boolean;
  /** The spans belong to the occurrence shown before, while this one loads. */
  isStale: boolean;
  refetch: () => void;
}

/**
 * Everything that differs between the apps on the Explore pages, as data. It
 * travels in router context, so the trace loader and the page components read
 * one value.
 */
export interface ExploreBackend {
  repos: {
    logs: LogsRepositoryLike;
    traces: TracesRepositoryLike;
    metrics: MetricsRepositoryLike;
    errors: ErrorsRepositoryLike;
    profiles: ProfilesRepositoryLike;
    /** The runtime metrics the Profiles page charts above the flame graph. */
    runtimeMetrics: RuntimeMetricsRepositoryLike;
  };
  /** Wraps every Explore page, in place of the page while the data source is not ready. */
  Gate?: ComponentType<{ children: ReactNode }>;
  /**
   * The spans the error trace panel draws for a trace. A hook, not query
   * options: each app reads a query whose cached rows have its own shape and
   * maps them, and the panel cannot name that shape.
   */
  useErrorTraceSpans: (traceId: string, enabled: boolean) => ErrorTraceSpans;
  /** The link from a log row to its CI run, for an app that has CI runs. */
  ciRunLinks?: Pick<LogsExplorerProps, "resolveJobId" | "renderRunLink">;
  /** Plays session recordings, for an app that stores them. */
  sessionRecordings?: SessionRecordingsHost;
}

/** The router context an app that mounts the Explore routes must provide. */
export interface ShellRouterContext {
  queryClient: QueryClient;
  explore: ExploreBackend;
}

export function useExploreBackend(): ExploreBackend {
  return useRouter().options.context.explore;
}
