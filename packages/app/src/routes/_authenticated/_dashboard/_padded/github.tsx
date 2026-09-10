import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { ScrollArea } from "@everr/ui/components/scroll-area";
import { cn } from "@everr/ui/lib/utils";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, GitBranch, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { GithubInstall } from "@/components/github-install";
import { PageHeader } from "@/components/page-header";
import {
  getGithubAppInstallStatus,
  getInstallationRepos,
  importRepos,
} from "@/data/github";

const githubInstallStatusOptions = queryOptions({
  queryKey: ["github", "install-status"],
  queryFn: () => getGithubAppInstallStatus(),
  staleTime: 5 * 60_000,
});

const githubReposOptions = queryOptions({
  queryKey: ["github", "installation-repos"],
  queryFn: () => getInstallationRepos(),
});

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_padded/github",
)({
  staticData: { breadcrumb: "GitHub", hideTimeRangePicker: true },
  head: () => ({ meta: [{ title: "Everr - GitHub" }] }),
  loader: async ({ context: { queryClient } }) => {
    await queryClient.prefetchQuery(githubInstallStatusOptions);
  },
  component: GithubPage,
});

function GithubPage() {
  const queryClient = useQueryClient();
  const { data: installations } = useQuery(githubInstallStatusOptions);
  const installed =
    installations?.some((installation) => installation.installed) ?? false;

  const handleInstalled = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: githubInstallStatusOptions.queryKey,
      }),
      queryClient.invalidateQueries({ queryKey: githubReposOptions.queryKey }),
    ]);
  }, [queryClient]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title="GitHub"
        lede="Connect GitHub and import recent workflow history into this organization."
        icon={GitBranch}
      />

      <Card>
        <CardHeader>
          <CardTitle>GitHub App</CardTitle>
          <CardDescription>
            The installation is scoped to the active Everr organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GithubInstall installed={installed} onInstalled={handleInstalled} />
        </CardContent>
      </Card>

      {installed ? <RepositoryImport /> : null}
    </div>
  );
}

const MAX_SELECTED_REPOS = 3;

function RepositoryImport() {
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [importingRepo, setImportingRepo] = useState<string | null>(null);
  const [runsProcessed, setRunsProcessed] = useState(0);

  const reposQuery = useQuery(githubReposOptions);
  const importMutation = useMutation({
    mutationFn: async () => {
      let totalJobs = 0;
      let totalErrors = 0;
      const stream = await importRepos({
        data: { repos: Array.from(selectedRepos) },
      });

      for await (const event of stream) {
        if (event.type === "repo-start") {
          setImportingRepo(event.repoFullName);
        } else if (event.type === "progress") {
          setRunsProcessed(event.progress.runsProcessed);
        } else if (event.type === "done") {
          totalJobs = event.totalJobs;
          totalErrors = event.totalErrors;
        }
      }

      return { totalJobs, totalErrors };
    },
    onSuccess: () => {
      setSelectedRepos(new Set());
      setImportingRepo(null);
      setRunsProcessed(0);
    },
    onError: () => {
      setImportingRepo(null);
      setRunsProcessed(0);
    },
  });

  function toggleRepo(fullName: string) {
    setSelectedRepos((current) => {
      const next = new Set(current);
      if (next.has(fullName)) {
        next.delete(fullName);
      } else if (next.size < MAX_SELECTED_REPOS) {
        next.add(fullName);
      }
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import workflow history</CardTitle>
        <CardDescription>
          Select up to three repositories per import. You can return and import
          more repositories later.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {reposQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}

        {reposQuery.isError ? (
          <p className="text-destructive text-sm" role="alert">
            Failed to load repositories. Please try again.
          </p>
        ) : null}

        {reposQuery.data?.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No repositories are available for this installation.
          </p>
        ) : null}

        {reposQuery.data && reposQuery.data.length > 0 ? (
          <ScrollArea
            className="max-h-72 border"
            viewportClassName="space-y-1 p-2"
            viewportProps={{ render: <ul /> }}
          >
            {reposQuery.data.map((repo) => {
              const selected = selectedRepos.has(repo.fullName);
              const disabled =
                !selected && selectedRepos.size >= MAX_SELECTED_REPOS;

              return (
                <li key={repo.id}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                      selected
                        ? "bg-primary/10 text-foreground"
                        : disabled
                          ? "cursor-not-allowed text-muted-foreground/40"
                          : "text-muted-foreground hover:bg-muted/50",
                    )}
                    disabled={disabled || importMutation.isPending}
                    onClick={() => toggleRepo(repo.fullName)}
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center border",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/30",
                      )}
                    >
                      {selected ? <Check className="size-3" /> : null}
                    </span>
                    <span className="truncate">{repo.fullName}</span>
                  </button>
                </li>
              );
            })}
          </ScrollArea>
        ) : null}

        {importMutation.isPending ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="size-4 animate-spin" />
            Importing
            {importingRepo ? ` ${importingRepo}` : " repositories"}
            {runsProcessed > 0 ? `, ${runsProcessed} runs processed` : ""}
            ...
          </div>
        ) : null}

        {importMutation.isSuccess ? (
          <div className="border border-emerald-500/30 bg-emerald-500/5 p-3 text-emerald-600 text-sm">
            Import complete. Workflow data will appear gradually.{" "}
            <Link to="/runs" className="font-medium underline">
              View runs
            </Link>
          </div>
        ) : null}

        {importMutation.isError ? (
          <p className="text-destructive text-sm" role="alert">
            Import failed. Please try again.
          </p>
        ) : null}

        <div className="flex justify-end border-t pt-5">
          <Button
            type="button"
            disabled={selectedRepos.size === 0 || importMutation.isPending}
            onClick={() => importMutation.mutate()}
          >
            {importMutation.isPending ? (
              <Loader2 className="animate-spin" />
            ) : null}
            Import selected
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
