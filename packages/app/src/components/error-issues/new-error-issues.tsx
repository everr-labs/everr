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
import { TagsInput } from "@everr/ui/components/tags-input";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import { type ReactNode, useState } from "react";
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
            onCancel={() => setOpen(false)}
          />
        )}
      </Dialog>
    </div>
  );
}

const GUIDE_URL = "https://everr.dev/docs/guides/fix-errors-with-agents";

function SetupForm({
  state,
  pending,
  onSubmit,
  onCancel,
}: {
  state: ErrorIssuesState;
  pending: boolean;
  onSubmit: (settings: ErrorIssuesSettings) => void;
  onCancel: () => void;
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
  const [githubAssignees, setGithubAssignees] = useState<string[]>(
    stored?.type === "github_issues" ? stored.assignees : [],
  );
  const keepsKey = stored?.type === "linear";
  const [handoff, setHandoff] = useState<ErrorIssuesHandoff>(state.handoff);
  const [minOccurrences, setMinOccurrences] = useState(String(state.minOccurrences));
  const [ignore, setIgnore] = useState<string[]>(state.ignore);
  const toAgent = handoff === "agent";
  const github = destination === "github_issues";

  const submit = () => {
    const common = { environment, handoff, minOccurrences: Number(minOccurrences), ignore };
    if (github) {
      onSubmit({ ...common, target: { type: "github_issues", assignees: githubAssignees } });
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
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
      <DialogHeader className="border-b px-6 pt-5 pb-4">
        <DialogTitle className="text-base">Issues for new errors</DialogTitle>
        <DialogDescription>
          One issue per new error, ready for a coding agent. Everr reopens it if the error comes
          back after the fix ships.
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="min-h-0 flex-1 divide-y overflow-y-auto px-6">
          <Section title="Destination" hint="Where issues open, and the environment Everr watches.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Open issues in" htmlFor="error-issues-destination">
                <OptionCombobox
                  id="error-issues-destination"
                  value={destination}
                  disabled={pending}
                  onChange={(value) =>
                    setDestination(value === "linear" ? "linear" : "github_issues")
                  }
                  options={DESTINATION_OPTIONS}
                />
              </Field>
              <Field label="Environment" htmlFor="error-issues-environment">
                <OptionCombobox
                  id="error-issues-environment"
                  value={environment}
                  disabled={pending}
                  onChange={setEnvironment}
                  options={environmentOptions}
                  searchable={environmentOptions.length > 8}
                />
              </Field>
              {!github && (
                <>
                  <Field label="Linear API key" htmlFor="error-issues-api-key">
                    <SecretInput
                      id="error-issues-api-key"
                      className="font-mono"
                      value={apiKey}
                      disabled={pending}
                      hasStoredSecret={keepsKey}
                      onValueChange={setApiKey}
                      placeholder="lin_api_..."
                    />
                  </Field>
                  <Field label="Team key" htmlFor="error-issues-team">
                    <Input
                      id="error-issues-team"
                      className="font-mono"
                      placeholder="ENG"
                      value={team}
                      disabled={pending}
                      onChange={(event) => setTeam(event.target.value)}
                    />
                  </Field>
                </>
              )}
            </div>
          </Section>

          <Section
            title="Which errors"
            hint="Errors first seen in the last week. At most 5 issues are open per repository or team; the rest wait, busiest first."
          >
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Label htmlFor="error-issues-min-occurrences" className="font-normal">
                  Open an issue after
                </Label>
                <Input
                  id="error-issues-min-occurrences"
                  type="number"
                  min={1}
                  max={1000}
                  required
                  className="w-16 text-center"
                  value={minOccurrences}
                  disabled={pending}
                  onChange={(event) => setMinOccurrences(event.target.value)}
                />
                <span>occurrences in a day, one per trace</span>
              </div>
              <Field
                label="Skip errors containing"
                note="Matched against the type and message, in any case. No code change fixes network errors and timeouts."
              >
                <TagsInput
                  aria-label="Skip errors containing"
                  value={ignore}
                  onValueChange={setIgnore}
                  disabled={pending}
                  placeholder="Add text to skip"
                />
              </Field>
            </div>
          </Section>

          <Section title="Hand-off" hint="When the coding agent gets an issue.">
            <div className="space-y-3">
              <fieldset className="grid gap-2 sm:grid-cols-2">
                <legend className="sr-only">Hand-off</legend>
                <HandoffOption
                  selected={handoff === "agent"}
                  disabled={pending}
                  title="Right away"
                  onSelect={() => setHandoff("agent")}
                >
                  Labeled <span className="font-mono">everr-fix</span> and assigned below, which
                  starts the agent.
                </HandoffOption>
                <HandoffOption
                  selected={handoff === "review"}
                  disabled={pending}
                  title="After review"
                  onSelect={() => setHandoff("review")}
                >
                  A person adds <span className="font-mono">everr-fix</span> or assigns the agent.
                </HandoffOption>
              </fieldset>
              {toAgent && (
                <Field label="Assign to" htmlFor={github ? undefined : "error-issues-assignee"}>
                  {github ? (
                    <TagsInput
                      aria-label="GitHub logins to assign"
                      className="font-mono"
                      value={githubAssignees}
                      onValueChange={setGithubAssignees}
                      disabled={pending}
                      placeholder="GitHub login, such as fix-agent[bot]"
                    />
                  ) : (
                    <Input
                      id="error-issues-assignee"
                      placeholder="Email or name of a person or agent"
                      value={assignee}
                      disabled={pending}
                      onChange={(event) => setAssignee(event.target.value)}
                    />
                  )}
                </Field>
              )}
            </div>
          </Section>

          {github && (
            <Section
              title="Repositories"
              hint="Each error opens in its service's repository. Errors from a service with none wait up to a week. Public repositories are refused."
            >
              <ServiceRepositoryList environment={environment} />
            </Section>
          )}
        </div>

        <DialogFooter className="items-center border-t px-6 py-3 sm:justify-between">
          <p className="text-muted-foreground text-xs">
            Your agent needs an{" "}
            <Link to="/api-keys" className="text-foreground underline">
              API key
            </Link>{" "}
            with Query telemetry.{" "}
            <a
              href={GUIDE_URL}
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline"
            >
              Guide
            </a>
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {state.enabled ? "Save" : "Turn on"}
            </Button>
          </div>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function HandoffOption({
  selected,
  disabled,
  title,
  onSelect,
  children,
}: {
  selected: boolean;
  disabled: boolean;
  title: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "has-[:focus-visible]:ring-ring/50 flex cursor-pointer flex-col gap-1 rounded-md border p-3 transition-colors has-[:disabled]:cursor-default has-[:disabled]:opacity-50 has-[:focus-visible]:ring-2",
        selected ? "border-primary bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <input
        type="radio"
        name="error-issues-handoff"
        className="sr-only"
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
      />
      <span className="flex items-center gap-2 text-xs font-medium">
        <span
          aria-hidden
          className={cn(
            "flex size-3.5 items-center justify-center rounded-full border",
            selected && "border-primary",
          )}
        >
          {selected && <span className="bg-primary size-1.5 rounded-full" />}
        </span>
        {title}
      </span>
      <span className="text-muted-foreground text-xs">{children}</span>
    </label>
  );
}

/** A titled block of the form: what it decides on the left, its controls on
 *  the right. Stacks on narrow screens. */
function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="grid gap-x-8 gap-y-3 py-5 sm:grid-cols-[11rem_1fr]">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  note,
  children,
}: {
  label: string;
  htmlFor?: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-muted-foreground text-xs font-normal">
        {label}
      </Label>
      {children}
      {note && <p className="text-muted-foreground text-xs">{note}</p>}
    </div>
  );
}
