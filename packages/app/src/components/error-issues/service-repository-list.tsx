import { Button } from "@everr/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@everr/ui/components/collapsible";
import { OptionCombobox } from "@everr/ui/components/option-combobox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Copy } from "lucide-react";
import { toast } from "sonner";
import type {
  ServiceRepositoryLink,
  ServiceRepositorySource,
} from "#app/data/service-repositories/links.server.ts";
import {
  serviceRepositoriesQueryKey,
  serviceRepositoryLinksOptions,
} from "#app/data/service-repositories/options.ts";
import {
  linkServiceRepository,
  sendHeldServiceIssues,
} from "#app/data/service-repositories/server.ts";

const SOURCE_TEXT: Record<ServiceRepositorySource, string> = {
  set: "set by hand",
  attribute: "from vcs.repository.*",
  commit: "from the service.version commit in CI",
  only_repository: "the only repository in CI",
};

/** Whether a service needs someone: no repository, or issues still waiting. */
function needsAttention(link: ServiceRepositoryLink): boolean {
  return link.repository === null || link.held > 0;
}

function issuesText(count: number): string {
  return count === 1 ? "1 issue" : `${count} issues`;
}

function sentToast({ sent }: { sent: number }) {
  if (sent > 0) toast.success(`Sending ${issuesText(sent)}`);
}

/**
 * The services in an environment that need a repository, and, folded away,
 * the ones Everr already places. A pick is saved for the service, wins from
 * then on, and sends the issues that were waiting for it.
 */
export function ServiceRepositoryList({ environment }: { environment: string }) {
  const queryClient = useQueryClient();
  const links = useQuery(serviceRepositoryLinksOptions(environment));
  const invalidate = () => queryClient.invalidateQueries({ queryKey: serviceRepositoriesQueryKey });
  const link = useMutation({
    mutationFn: (input: { service: string; repository: string | null }) =>
      linkServiceRepository({ data: input }),
    onSuccess: (result) => {
      sentToast(result);
      return invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const send = useMutation({
    mutationFn: (service: string) => sendHeldServiceIssues({ data: { service } }),
    onSuccess: (result) => {
      sentToast(result);
      return invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (links.isPending) {
    return <p className="text-muted-foreground text-xs">Finding services…</p>;
  }
  if (links.isError) {
    return <p className="text-destructive text-xs">Could not load services.</p>;
  }
  const { links: rows, repositories } = links.data;
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        No service logged in <span className="font-mono">{environment}</span> in the last week.
      </p>
    );
  }
  const busy = (service: string) =>
    (link.isPending && link.variables.service === service) ||
    (send.isPending && send.variables === service);
  const needing = rows.filter(needsAttention);
  const placed = rows.filter((row) => !needsAttention(row));

  return (
    <div className="space-y-2">
      {needing.length === 0 ? (
        <p className="text-xs">
          Every service in <span className="font-mono">{environment}</span> has a repository.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {needing.map((row) => (
            <NeedingRow
              key={row.service}
              row={row}
              repositories={repositories}
              pending={busy(row.service)}
              onLink={(repository) => link.mutate({ service: row.service, repository })}
              onSend={() => send.mutate(row.service)}
            />
          ))}
        </ul>
      )}
      {placed.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex items-center gap-1 text-xs">
            <ChevronRight
              aria-hidden
              className="size-3 transition-transform group-data-[panel-open]:rotate-90"
            />
            {placed.length} {placed.length === 1 ? "service has" : "services have"} a repository
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 divide-y rounded-md border">
              {placed.map((row) => (
                <PlacedRow
                  key={row.service}
                  row={row}
                  repositories={repositories}
                  pending={busy(row.service)}
                  onLink={(repository) => link.mutate({ service: row.service, repository })}
                />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

function repositoryOptions(row: ServiceRepositoryLink, repositories: string[]) {
  // A repository Everr read from an attribute may be one it has no CI for.
  return [...new Set([...(row.repository ? [row.repository] : []), ...repositories])].map(
    (repo) => ({ value: repo, label: <span className="font-mono">{repo}</span> }),
  );
}

function RepositoryPicker({
  row,
  repositories,
  pending,
  onLink,
}: {
  row: ServiceRepositoryLink;
  repositories: string[];
  pending: boolean;
  onLink: (repository: string | null) => void;
}) {
  const options = repositoryOptions(row, repositories);
  return (
    <OptionCombobox
      label={`Repository for ${row.service}`}
      className="w-56"
      value={row.repository}
      placeholder={options.length > 0 ? "Pick a repository" : "No repository found"}
      options={options}
      searchable={options.length > 8}
      disabled={pending || options.length === 0}
      onChange={onLink}
    />
  );
}

function NeedingRow({
  row,
  repositories,
  pending,
  onLink,
  onSend,
}: {
  row: ServiceRepositoryLink;
  repositories: string[];
  pending: boolean;
  onLink: (repository: string | null) => void;
  onSend: () => void;
}) {
  return (
    <li className="space-y-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs">{row.service}</p>
          {row.held > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {issuesText(row.held)} waiting for a repository
            </p>
          )}
        </div>
        {row.repository === null ? (
          <RepositoryPicker
            row={row}
            repositories={repositories}
            pending={pending}
            onLink={onLink}
          />
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs">{row.repository}</span>
            <Button type="button" size="sm" disabled={pending} onClick={onSend}>
              Send {issuesText(row.held)}
            </Button>
          </div>
        )}
      </div>
      {row.repository === null && <AttributeHint service={row.service} known={repositories} />}
    </li>
  );
}

/** The lasting fix: the service says where its code lives, and every Everr
 *  feature reads it from then on. */
function AttributeHint({ service, known }: { service: string; known: string[] }) {
  const guess =
    known.find((repo) => repo.split("/")[1]?.toLowerCase() === service.toLowerCase()) ??
    "OWNER/REPO";
  const line = `OTEL_RESOURCE_ATTRIBUTES=vcs.repository.url.full=https://github.com/${guess}`;
  return (
    <Collapsible>
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex items-center gap-1 text-xs">
        <ChevronRight
          aria-hidden
          className="size-3 transition-transform group-data-[panel-open]:rotate-90"
        />
        Or have the service report it
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1.5 pt-1.5">
        <div className="bg-muted flex items-start gap-2 rounded-md p-2">
          <code className="min-w-0 flex-1 font-mono text-xs break-all">{line}</code>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Copy"
            onClick={() => {
              void navigator.clipboard.writeText(line).then(() => toast.success("Copied"));
            }}
          >
            <Copy aria-hidden />
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Set in the service&apos;s environment, or add{" "}
          <span className="font-mono">vcs.repository.url.full</span> to its OpenTelemetry resource.
          Once its logs carry it, send the waiting issues from here.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function PlacedRow({
  row,
  repositories,
  pending,
  onLink,
}: {
  row: ServiceRepositoryLink;
  repositories: string[];
  pending: boolean;
  onLink: (repository: string | null) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{row.service}</span>
      <div className="flex min-w-0 flex-col items-end gap-0.5">
        <RepositoryPicker row={row} repositories={repositories} pending={pending} onLink={onLink} />
        {row.source && (
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            {SOURCE_TEXT[row.source]}
            {row.source === "set" && (
              <Button
                type="button"
                size="sm"
                variant="link"
                className="h-auto p-0 text-xs"
                disabled={pending}
                onClick={() => onLink(null)}
              >
                Reset
              </Button>
            )}
          </span>
        )}
      </div>
    </li>
  );
}
