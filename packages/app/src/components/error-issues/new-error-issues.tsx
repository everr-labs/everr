import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { OptionCombobox } from "@everr/ui/components/option-combobox";
import { SecretInput } from "@everr/ui/components/secret-input";
import { Textarea } from "@everr/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { invalidateAlertNotifications } from "#app/data/alerting/delivery/options.ts";
import type {
  ErrorIssuesHandoff,
  ErrorIssuesSettings,
  ErrorIssuesState,
} from "#app/data/error-issues/automation.server.ts";
import { ERROR_ISSUES_RULE_NAME } from "#app/data/error-issues/detection.ts";
import {
  errorIssueEnvironmentsOptions,
  errorIssuesOptions,
  errorIssuesQueryKey,
} from "#app/data/error-issues/options.ts";
import { turnOffErrorIssues, turnOnErrorIssues } from "#app/data/error-issues/server.ts";
import { serviceRepositoryLinksOptions } from "#app/data/service-repositories/options.ts";
import { CHANNEL_OPTIONS } from "../alerts/channel-mark";
import { ServiceRepositoryList } from "./service-repository-list";

type Destination = "github_issues" | "linear";

const HANDOFF_OPTIONS: { value: ErrorIssuesHandoff; label: string }[] = [
  { value: "agent", label: "Right away" },
  { value: "review", label: "After someone reviews it" },
];

const DESTINATION_OPTIONS = CHANNEL_OPTIONS.filter(
  (option) => option.value === "github_issues" || option.value === "linear",
);

function destinationText(target: ErrorIssuesState["target"]): string {
  if (target?.type === "linear") return `Linear team ${target.team}`;
  if (target?.type === "github_issues") return "GitHub, in each service's repository";
  return "";
}

/** What needs a repository before issues can open, while GitHub is the
 *  destination: issues already waiting, and services Everr cannot place. */
function useRepositoryGaps(
  environment: string | null,
  github: boolean,
): { held: number; unlinked: number } {
  const links = useQuery({
    ...serviceRepositoryLinksOptions(environment ?? undefined),
    enabled: github && environment !== null,
  });
  const rows = links.data?.links ?? [];
  return {
    held: rows.reduce((total, link) => total + link.held, 0),
    unlinked: rows.filter((link) => link.repository === null).length,
  };
}

function gapText({ held, unlinked }: { held: number; unlinked: number }): string | null {
  if (held > 0) return `${held} ${held === 1 ? "issue is" : "issues are"} waiting for a repository`;
  if (unlinked > 0) {
    return `${unlinked} ${unlinked === 1 ? "service has" : "services have"} no repository`;
  }
  return null;
}

/**
 * The strip above the Errors list that turns new production errors into
 * issues for a coding agent, and the dialog behind it. One decision from the
 * user; Everr manages the rule and the channel that carry it out.
 */
export function NewErrorIssues() {
  const queryClient = useQueryClient();
  const state = useQuery(errorIssuesOptions());
  const [open, setOpen] = useState(false);

  const refresh = (next: ErrorIssuesState) => {
    queryClient.setQueryData(errorIssuesQueryKey, next);
    void invalidateAlertNotifications(queryClient);
  };
  const turnOn = useMutation({
    mutationFn: (settings: ErrorIssuesSettings) => turnOnErrorIssues({ data: settings }),
    onSuccess: (next) => {
      refresh(next);
      setOpen(false);
      toast.success("New errors will open issues");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const turnOff = useMutation({
    mutationFn: () => turnOffErrorIssues(),
    onSuccess: (next) => {
      refresh(next);
      toast.success("New errors no longer open issues");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const github = state.data?.enabled === true && state.data.target?.type === "github_issues";
  const gap = gapText(useRepositoryGaps(state.data?.environment ?? null, github));

  if (!state.data) return null;
  const { enabled, environment, target, waiting } = state.data;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 text-xs">
      <Bot aria-hidden className="text-muted-foreground size-4 shrink-0" />
      <p className="min-w-0 flex-1">
        {enabled ? (
          <>
            New errors in <span className="font-mono">{environment}</span> open issues:{" "}
            {destinationText(target)}.{" "}
            {waiting > 0 && (
              <>
                {waiting} more {waiting === 1 ? "waits" : "wait"} for an open issue to close, the
                one hitting the most requests first.{" "}
              </>
            )}
            {github && gap && (
              <>
                <button
                  type="button"
                  className="text-amber-600 underline dark:text-amber-400"
                  onClick={() => setOpen(true)}
                >
                  {gap}
                </button>
                .{" "}
              </>
            )}
            <Link to="/alerts" search={{ alert: ERROR_ISSUES_RULE_NAME }} className="underline">
              See the rule
            </Link>
          </>
        ) : (
          <span className="text-muted-foreground">
            Open a GitHub or Linear issue for every new production error, ready for your coding
            agent to fix.
          </span>
        )}
      </p>
      <div className="flex items-center gap-2">
        {enabled && (
          <Button
            size="sm"
            variant="ghost"
            disabled={turnOff.isPending}
            onClick={() => turnOff.mutate()}
          >
            Turn off
          </Button>
        )}
        <Button size="sm" variant={enabled ? "outline" : "default"} onClick={() => setOpen(true)}>
          {enabled ? "Change" : "Set up"}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={(next) => !turnOn.isPending && setOpen(next)}>
        {open && (
          <SetupForm
            state={state.data}
            pending={turnOn.isPending}
            onSubmit={(settings) => turnOn.mutate(settings)}
          />
        )}
      </Dialog>
    </div>
  );
}

function SetupForm({
  state,
  pending,
  onSubmit,
}: {
  state: ErrorIssuesState;
  pending: boolean;
  onSubmit: (settings: ErrorIssuesSettings) => void;
}) {
  const stored = state.target;
  // Seeded once per opening: the dialog remounts this form each time.
  const [destination, setDestination] = useState<Destination>(
    stored?.type === "linear" ? "linear" : "github_issues",
  );
  const [environment, setEnvironment] = useState(state.environment ?? "production");
  const environments = useQuery(errorIssueEnvironmentsOptions());
  const environmentOptions = [...new Set([environment, ...(environments.data ?? [])])].map(
    (value) => ({ value, label: <span className="font-mono">{value}</span> }),
  );
  const [apiKey, setApiKey] = useState("");
  const [team, setTeam] = useState(stored?.type === "linear" ? stored.team : "");
  const [assignee, setAssignee] = useState(
    stored?.type === "linear" ? (stored.assignee ?? "") : "",
  );
  const [githubAssignees, setGithubAssignees] = useState(
    stored?.type === "github_issues" ? stored.assignees.join(", ") : "",
  );
  const keepsKey = stored?.type === "linear";
  const [handoff, setHandoff] = useState<ErrorIssuesHandoff>(state.handoff);
  const [minOccurrences, setMinOccurrences] = useState(String(state.minOccurrences));
  const [ignore, setIgnore] = useState(state.ignore.join("\n"));
  const toAgent = handoff === "agent";

  const submit = () => {
    const common = {
      environment,
      handoff,
      minOccurrences: Number(minOccurrences),
      ignore: ignore
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    };
    if (destination === "github_issues") {
      const assignees = githubAssignees
        .split(",")
        .map((login) => login.trim())
        .filter(Boolean);
      onSubmit({ ...common, target: { type: "github_issues", assignees } });
      return;
    }
    onSubmit({
      ...common,
      target: {
        type: "linear",
        ...(apiKey ? { api_key: apiKey } : {}),
        team,
        ...(assignee.trim() ? { assignee: assignee.trim() } : {}),
      },
    });
  };

  return (
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Issues for new errors</DialogTitle>
        <DialogDescription>
          Each error first seen in the last week becomes one issue, labeled{" "}
          <span className="font-mono">everr</span>, with a link back to Everr. At most 5 are open
          per repository or Linear team; the rest wait, the one hitting the most requests first.
          When an issue closes, Everr reopens it if the error comes back in a later release.
        </DialogDescription>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="error-issues-destination">Open issues in</Label>
          <OptionCombobox
            id="error-issues-destination"
            value={destination}
            disabled={pending}
            onChange={(value) => setDestination(value === "linear" ? "linear" : "github_issues")}
            options={DESTINATION_OPTIONS}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="error-issues-environment">Environment</Label>
          <OptionCombobox
            id="error-issues-environment"
            className="w-48"
            value={environment}
            disabled={pending}
            onChange={setEnvironment}
            options={environmentOptions}
            searchable={environmentOptions.length > 8}
          />
          <p className="text-muted-foreground text-xs">
            The <span className="font-mono">deployment.environment.name</span> values services
            reported in the last week.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="error-issues-min-occurrences">Open an issue once an error happens</Label>
          <div className="flex items-center gap-2 text-sm">
            <Input
              id="error-issues-min-occurrences"
              type="number"
              min={1}
              max={1000}
              required
              className="w-20"
              value={minOccurrences}
              disabled={pending}
              onChange={(event) => setMinOccurrences(event.target.value)}
            />
            <span>times in a day</span>
          </div>
          <p className="text-muted-foreground text-xs">
            Each trace counts once. A single occurrence is often a fluke that never comes back.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="error-issues-ignore">Skip errors whose type or message contains</Label>
          <Textarea
            id="error-issues-ignore"
            className="min-h-24 font-mono text-xs"
            value={ignore}
            disabled={pending}
            onChange={(event) => setIgnore(event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            One per line, in any case. The list starts with network errors and timeouts, which no
            code change fixes.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="error-issues-handoff">Hand each issue to the agent</Label>
          <OptionCombobox
            id="error-issues-handoff"
            className="w-56"
            value={handoff}
            disabled={pending}
            onChange={(value) => setHandoff(value === "review" ? "review" : "agent")}
            options={HANDOFF_OPTIONS}
          />
          <p className="text-muted-foreground text-xs">
            {toAgent ? (
              <>
                Issues open with the <span className="font-mono">everr-fix</span> label and the
                assignee below, which start the agent.
              </>
            ) : (
              <>
                Issues open without the agent&apos;s label or assignee. Add{" "}
                <span className="font-mono">everr-fix</span>, or assign the agent, to hand one over.
              </>
            )}
          </p>
        </div>
        {destination === "github_issues" ? (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Where each service&apos;s errors go</p>
            <ServiceRepositoryList environment={environment} />
            <p className="text-muted-foreground text-xs">
              An error from a service with no repository waits, for up to a week, and opens its
              issue once the service has one. Public repositories are refused.
            </p>
            {toAgent && (
              <div className="space-y-1.5 pt-2">
                <Label htmlFor="error-issues-github-assignees">Assign to</Label>
                <Input
                  id="error-issues-github-assignees"
                  className="font-mono"
                  placeholder="GitHub logins, comma-separated"
                  value={githubAssignees}
                  disabled={pending}
                  onChange={(event) => setGithubAssignees(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  A person, or the account a coding agent works as: assigning an issue starts it.
                </p>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="error-issues-api-key">API key</Label>
              <SecretInput
                id="error-issues-api-key"
                className="font-mono"
                value={apiKey}
                disabled={pending}
                hasStoredSecret={keepsKey}
                onValueChange={setApiKey}
                placeholder="lin_api_..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="error-issues-team">Team key</Label>
              <Input
                id="error-issues-team"
                className="w-32 font-mono"
                placeholder="ENG"
                value={team}
                disabled={pending}
                onChange={(event) => setTeam(event.target.value)}
              />
            </div>
            {toAgent && (
              <div className="space-y-1.5">
                <Label htmlFor="error-issues-assignee">Assignee</Label>
                <Input
                  id="error-issues-assignee"
                  placeholder="Email or name"
                  value={assignee}
                  disabled={pending}
                  onChange={(event) => setAssignee(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  A person or an agent. Assigning an issue to an agent delegates it.
                </p>
              </div>
            )}
          </>
        )}
        <AgentAccessNote />
        <DialogFooter>
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {state.enabled ? "Save" : "Turn on"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** What an agent working from these issues needs to read the error. */
function AgentAccessNote() {
  return (
    <div className="bg-muted/50 space-y-1 rounded-md p-3 text-xs">
      <p className="font-medium">Your agent reads each error from Everr</p>
      <p className="text-muted-foreground">
        An issue names the error, with its message&apos;s ids, numbers, emails, and URLs replaced,
        and the query that pulls its occurrences. It copies no stack trace or raw message. Give the
        agent an{" "}
        <Link to="/api-keys" className="underline">
          API key
        </Link>{" "}
        with <span className="font-mono">Query telemetry</span> as{" "}
        <span className="font-mono">EVERR_API_KEY</span>, and this installation&apos;s URL as{" "}
        <span className="font-mono">EVERR_API_URL</span>.
      </p>
    </div>
  );
}
