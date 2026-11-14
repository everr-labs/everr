import { useQuery } from "@tanstack/react-query";
import GithubIcon from "#app/assets/github.svg?react";
import LinearIcon from "#app/assets/linear.svg?react";
import type { TrackedErrorIssue } from "#app/data/error-issues/automation.server.ts";
import { trackedErrorIssuesOptions } from "#app/data/error-issues/options.ts";

const STATUS_TEXT: Record<TrackedErrorIssue["status"], string> = {
  open: "open",
  closed: "closed",
  fixed: "fixed: a release ran a day without it",
  not_planned: "closed as not planned",
};

/** The issue Everr opened for an error, beside it in the Errors list. */
export function TrackedIssueLink({ fingerprint }: { fingerprint: string }) {
  const tracked = useQuery(trackedErrorIssuesOptions());
  const issue = tracked.data?.[fingerprint];
  if (!issue) return null;
  const Icon = issue.provider === "github" ? GithubIcon : LinearIcon;
  return (
    <a
      href={issue.url}
      target="_blank"
      rel="noreferrer"
      title={`Issue ${issue.label} in ${issue.location}, ${STATUS_TEXT[issue.status]}`}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-xs no-underline"
    >
      <Icon aria-hidden className="size-3" />
      {issue.label}
      {issue.status === "fixed" && (
        <span className="text-emerald-600 dark:text-emerald-400">fixed</span>
      )}
    </a>
  );
}
