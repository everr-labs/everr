import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import { Skeleton } from "@everr/ui/components/skeleton";
import { cn } from "@everr/ui/lib/utils";
import AnsiImport from "ansi-to-react";
import {
  Boxes,
  Check,
  Clock3,
  Copy,
  FileSearch,
  Fingerprint,
  GitBranch,
  Server,
  X,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import {
  keepPreviousData,
  useQuery,
} from "@tanstack/react-query";
import { logDetailOptions } from "../data/options";
import type { LogDetail, LogExplorerRow } from "../schemas";
import type { LogsRepositoryLike } from "../data/repository";
import { formatRelativeTime } from "../util/formatting";
import { LOG_LEVEL_META } from "./log-level-meta";

const Ansi =
  typeof AnsiImport === "function"
    ? AnsiImport
    : (AnsiImport as unknown as { default: typeof AnsiImport }).default;

export interface LogInspectorProps {
  detail: LogDetail;
  renderRunLink?: (ctx: {
    traceId: string;
    jobId: string;
    stepNumber: string;
  }) => React.ReactNode;
  resolveJobId?: (input: {
    traceId: string;
    jobName: string;
  }) => string | undefined;
}

export interface LogInspectorPanelProps {
  repo: LogsRepositoryLike;
  log: LogExplorerRow;
  onClose: () => void;
  renderRunLink?: LogInspectorProps["renderRunLink"];
  resolveJobId?: LogInspectorProps["resolveJobId"];
}

function levelBadgeClassName(level: LogExplorerRow["level"]) {
  return LOG_LEVEL_META[level].badgeClassName;
}

function useDelayedFlag(active: boolean, delayMs: number) {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (!active) {
      setDelayed(false);
      return;
    }
    const id = setTimeout(() => setDelayed(true), delayMs);
    return () => clearTimeout(id);
  }, [active, delayMs]);
  return delayed;
}

function severityLabel(log: LogDetail) {
  if (log.severityText) return log.severityText;
  if (log.severityNumber > 0) return String(log.severityNumber);
  return "N/A";
}

function extractCiContext(detail: LogDetail) {
  const repo = detail.resourceAttributes["vcs.repository.name"] ?? "";
  const branch = detail.resourceAttributes["vcs.ref.head.name"] ?? "";
  const workflowName = detail.resourceAttributes["cicd.pipeline.name"] ?? "";
  const runId = detail.resourceAttributes["cicd.pipeline.run.id"] ?? "";
  const jobId = detail.resourceAttributes["cicd.pipeline.task.run.id"] ?? "";
  const jobName = detail.scopeAttributes["cicd.pipeline.task.name"] ?? "";
  const stepNumber =
    detail.logAttributes["everr.github.workflow_job_step.number"] ?? "";
  return {
    repo,
    branch,
    workflowName,
    runId,
    jobId,
    jobName,
    stepNumber,
    hasAny: Boolean(
      branch || workflowName || runId || jobId || jobName || stepNumber,
    ),
  };
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 last:mb-0">
      <h2 className="text-muted-foreground mb-2 text-xs font-medium">
        {title}
      </h2>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function DetailItem({
  icon,
  label,
  value,
  mono,
}: {
  icon?: React.ReactNode;
  label: string;
  value?: string;
  mono?: boolean;
}) {
  return (
    <div className="group relative grid min-w-0 grid-cols-[96px_minmax(0,1fr)] gap-3 rounded-md border bg-background/70 px-2.5 py-2 text-xs">
      <span className="text-muted-foreground flex min-w-0 items-center gap-1">
        {icon ? <span className="[&>svg]:size-3">{icon}</span> : null}
        <span className="truncate">{label}</span>
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-right",
          mono && "font-mono",
          !value && "text-muted-foreground",
        )}
      >
        {value || "N/A"}
      </span>
      {value ? (
        <CopyValueButton
          value={value}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-background shadow-sm"
        />
      ) : null}
    </div>
  );
}

function CopyValueButton({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy value"}
      title={copied ? "Copied" : "Copy value"}
      onClick={handleCopy}
      className={cn(
        "text-muted-foreground hover:text-foreground hover:bg-muted-foreground/20 inline-flex size-5 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none",
        className,
      )}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}

function AttributeMap({
  title,
  map,
}: {
  title: string;
  map: Record<string, string>;
}) {
  const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return null;
  return (
    <DetailSection title={title}>
      {entries.map(([key, value]) => (
        <DetailItem key={key} label={key} value={value} mono />
      ))}
    </DetailSection>
  );
}

function LogInspectorSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, sectionIndex) => (
        <div key={sectionIndex} className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

function LogInspectorDetails({
  detail,
  renderRunLink,
  resolveJobId,
}: LogInspectorProps) {
  const ciFields = extractCiContext(detail);
  const resolvedJobId =
    ciFields.jobId ||
    (detail.traceId && ciFields.jobName
      ? resolveJobId?.({ traceId: detail.traceId, jobName: ciFields.jobName })
      : undefined) ||
    "";

  return (
    <>
      <DetailSection title="Event">
        <DetailItem
          icon={<Clock3 />}
          label="Timestamp"
          value={detail.timestamp}
        />
        <DetailItem
          icon={<Server />}
          label="Service"
          value={detail.serviceName}
        />
        <DetailItem label="Severity" value={severityLabel(detail)} />
        <DetailItem
          icon={<Boxes />}
          label="Source"
          value={ciFields.repo || "default"}
        />
      </DetailSection>

      <DetailSection title="Correlation">
        <DetailItem
          icon={<Fingerprint />}
          label="Trace ID"
          value={detail.traceId}
          mono
        />
        <DetailItem label="Span ID" value={detail.spanId} mono />
      </DetailSection>

      {ciFields.hasAny ? (
        <DetailSection title="CI/CD">
          <DetailItem
            icon={<GitBranch />}
            label="Branch"
            value={ciFields.branch}
          />
          <DetailItem label="Pipeline" value={ciFields.workflowName} />
          <DetailItem label="Execution ID" value={ciFields.runId} mono />
          <DetailItem label="Task" value={ciFields.jobName || ciFields.jobId} />
          <DetailItem label="Step" value={ciFields.stepNumber} />
          {detail.traceId && resolvedJobId && ciFields.stepNumber
            ? renderRunLink?.({
                traceId: detail.traceId,
                jobId: resolvedJobId,
                stepNumber: ciFields.stepNumber,
              }) ?? (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1 w-fit"
                  disabled
                >
                  <FileSearch data-icon="inline-start" />
                  Open in CI View
                </Button>
              )
            : null}
        </DetailSection>
      ) : null}

      <AttributeMap
        title="Resource attributes"
        map={detail.resourceAttributes}
      />
      <AttributeMap title="Log attributes" map={detail.logAttributes} />
      <AttributeMap title="Scope attributes" map={detail.scopeAttributes} />
    </>
  );
}

export function LogInspectorPanel({
  repo,
  log,
  onClose,
  renderRunLink,
  resolveJobId,
}: LogInspectorPanelProps) {
  const {
    data: detail,
    isPending,
    isError,
    isPlaceholderData,
  } = useQuery({
    ...logDetailOptions(repo, log.identity),
    placeholderData: keepPreviousData,
  });
  const showSkeleton = useDelayedFlag(isPending, 250);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b p-3">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Log event</div>
            <div className="text-muted-foreground text-xs">
              {formatRelativeTime(log.timestamp)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn("capitalize", levelBadgeClassName(log.level))}
            >
              {log.level}
            </Badge>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close log details"
              onClick={onClose}
            >
              <X />
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="group relative mb-4 rounded-md border bg-background p-3">
          <div className="text-muted-foreground mb-2 text-xs font-medium">
            Message
          </div>
          <div className="font-mono text-xs leading-5">
            <Ansi useClasses>{log.body}</Ansi>
          </div>
          <CopyValueButton
            value={log.body}
            className="absolute right-2 top-2 bg-background shadow-sm"
          />
        </div>

        {isError ? (
          <div className="text-destructive rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
            Failed to load log details
          </div>
        ) : detail ? (
          <div
            className={cn(
              "transition-opacity",
              isPlaceholderData && "opacity-50",
            )}
          >
            <LogInspectorDetails
              detail={detail}
              renderRunLink={renderRunLink}
              resolveJobId={resolveJobId}
            />
          </div>
        ) : showSkeleton ? (
          <LogInspectorSkeleton />
        ) : null}
      </div>
    </div>
  );
}
