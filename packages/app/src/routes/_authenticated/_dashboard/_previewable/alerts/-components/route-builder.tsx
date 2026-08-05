import { Button } from "@everr/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
} from "@everr/ui/components/collapsible";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { OptionCombobox } from "@everr/ui/components/option-combobox";
import { Switch } from "@everr/ui/components/switch";
import { TagsInput } from "@everr/ui/components/tags-input";
import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, LoaderCircle, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  CC_DEFAULT_GROUP_BY,
  CC_DEFAULT_GROUP_INTERVAL_SECS,
  CC_DEFAULT_GROUP_WAIT_SECS,
} from "@/data/cc/defaults";
import { ccQueries } from "@/data/cc/queries";
import { ccRouteTimingSummary } from "@/data/cc/route-timing";
import { createCcRoute, updateCcRoute } from "@/data/cc/server";
import type { CcMatcher, CcReceiver, CcRoute } from "@/data/cc/types";
import { MatchersEditor, matchersPhrase } from "./matchers-editor";
import { CcDisclosureTrigger, ccErrorMessage } from "./shared";

/** Parse a numeric duration field. Empty ⇒ null (CC default). */
function parseDuration(
  raw: string,
  min: number,
): { value: number | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, error: null };
  if (!/^\d+$/.test(trimmed))
    return { value: null, error: "Must be a whole number" };
  const value = Number(trimmed);
  if (value < min)
    return { value: null, error: `Must be at least ${min} seconds` };
  return { value, error: null };
}

export function PreviewLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 text-xs leading-relaxed [&_strong]:font-medium [&_strong]:text-foreground">
      {children}
    </div>
  );
}

export function routeOrderWarning(
  routes: CcRoute[],
  index: number,
  matchers: CcMatcher[],
  continueFlag: boolean,
  hasLaterRoutes = index < routes.length - 1,
) {
  const earlierRoutes = routes.slice(0, index);
  const blockingCatchAll = earlierRoutes.findIndex(
    (candidate) => candidate.matchers.length === 0 && !candidate.continue,
  );
  if (blockingCatchAll >= 0) {
    return `Unreachable: route ${blockingCatchAll + 1} matches every alert and stops evaluation.`;
  }

  const shadowingRoute = earlierRoutes.findIndex(
    (candidate) =>
      !candidate.continue &&
      candidate.matchers.every((matcher) =>
        matchers.some(
          (current) =>
            current.label === matcher.label &&
            current.op === matcher.op &&
            current.value === matcher.value,
        ),
      ),
  );
  if (shadowingRoute >= 0) {
    return `May be unreachable: route ${shadowingRoute + 1} also matches these alerts and stops evaluation.`;
  }

  if (matchers.length === 0 && !continueFlag && hasLaterRoutes) {
    return "Catch-all route: later routes will not be evaluated.";
  }
  return undefined;
}

function routeInput(route: CcRoute, priority: number) {
  return {
    matchers: route.matchers,
    receiver: route.receiver,
    continue: route.continue,
    priority,
    group_by: route.group_by,
    group_wait_secs: route.group_wait_secs,
    group_interval_secs: route.group_interval_secs,
    repeat_interval_secs: route.repeat_interval_secs,
  };
}

function DurationField({
  id,
  label,
  placeholder,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={0}
        className="tabular-nums"
        value={value}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function RouteBuilder({
  onCancel,
  receivers,
  routes,
  route,
  insertIndex,
  connectTop = false,
  connectBottom = false,
}: {
  onCancel: () => void;
  receivers: CcReceiver[];
  routes: CcRoute[];
  route: CcRoute | null;
  insertIndex?: number;
  connectTop?: boolean;
  connectBottom?: boolean;
}) {
  const qc = useQueryClient();
  const editorRef = useRef<HTMLLIElement | null>(null);
  const sortedRoutes = [...routes].sort((a, b) => a.priority - b.priority);
  const requestedIndex = route
    ? sortedRoutes.findIndex((candidate) => candidate.id === route.id)
    : (insertIndex ?? sortedRoutes.length);
  const routeIndex = Math.min(
    Math.max(requestedIndex, 0),
    route ? Math.max(sortedRoutes.length - 1, 0) : sortedRoutes.length,
  );
  const position = routeIndex + 1;
  const nextPriority =
    sortedRoutes.length === 0
      ? 0
      : Math.max(...sortedRoutes.map((candidate) => candidate.priority)) + 10;
  const [matchers, setMatchers] = useState<CcMatcher[]>(route?.matchers ?? []);
  const [receiver, setReceiver] = useState(route?.receiver ?? "");
  const priority =
    route?.priority ??
    (routeIndex === sortedRoutes.length ? nextPriority : routeIndex * 10);
  const isEdit = route !== null;
  const [continueFlag, setContinueFlag] = useState(route?.continue ?? false);
  const [timingOpen, setTimingOpen] = useState(false);
  const [groupBy, setGroupBy] = useState<string[]>(route?.group_by ?? []);
  const [groupWait, setGroupWait] = useState(
    route?.group_wait_secs != null ? String(route.group_wait_secs) : "",
  );
  const [groupInterval, setGroupInterval] = useState(
    route?.group_interval_secs != null ? String(route.group_interval_secs) : "",
  );
  const [repeatInterval, setRepeatInterval] = useState(
    route?.repeat_interval_secs != null
      ? String(route.repeat_interval_secs)
      : "",
  );

  const wait = parseDuration(groupWait, 0);
  const interval = parseDuration(groupInterval, 0);
  const repeat = parseDuration(repeatInterval, 60);
  const hasErrors = !!(wait.error || interval.error || repeat.error);
  const orderWarning = routeOrderWarning(
    sortedRoutes,
    routeIndex,
    matchers,
    continueFlag,
    isEdit
      ? routeIndex < sortedRoutes.length - 1
      : routeIndex < sortedRoutes.length,
  );

  const save = useMutation({
    mutationFn: async () => {
      const input = {
        matchers,
        receiver,
        continue: continueFlag,
        priority,
        group_by: groupBy.length > 0 ? groupBy : null,
        group_wait_secs: wait.value,
        group_interval_secs: interval.value,
        repeat_interval_secs: repeat.value,
      };
      if (isEdit) {
        return updateCcRoute({ data: { id: route.id, input } });
      }

      if (routeIndex < sortedRoutes.length) {
        for (const [index, existingRoute] of sortedRoutes.entries()) {
          const normalizedPriority =
            index < routeIndex ? index * 10 : (index + 1) * 10;
          if (existingRoute.priority !== normalizedPriority) {
            await updateCcRoute({
              data: {
                id: existingRoute.id,
                input: routeInput(existingRoute, normalizedPriority),
              },
            });
          }
        }
      }

      return createCcRoute({ data: input });
    },
    onSuccess: () => {
      onCancel();
      toast.success(isEdit ? "Route updated" : "Route created");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: ccQueries.routes().queryKey }),
  });

  return (
    <li
      ref={(node) => {
        if (node && editorRef.current === null) {
          editorRef.current = node;
          node.focus({ preventScroll: true });
        }
      }}
      aria-label={isEdit ? `Editing route ${position}` : "Creating a new route"}
      className="relative border-y border-border bg-background/60 py-3 pr-3 pl-13 outline-none"
      tabIndex={-1}
    >
      {connectTop && (
        <span
          aria-hidden
          className="absolute top-0 left-6.5 h-3 w-px -translate-x-1/2 bg-border"
        />
      )}
      {connectBottom && (
        <span
          aria-hidden
          className="absolute top-10 bottom-0 left-6.5 w-px -translate-x-1/2 bg-border"
        />
      )}
      <span className="absolute top-3 left-6.5 z-10 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-primary/30 bg-background font-mono text-xs text-primary tabular-nums">
        {position}
      </span>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (receiver && !hasErrors && !save.isPending) save.mutate();
        }}
      >
        <header
          className={cn("min-w-0", !isEdit && "flex min-h-7 items-center")}
        >
          <h3 className="text-sm font-medium text-foreground">
            {isEdit ? `Edit route ${position}` : "New route"}
          </h3>
          {isEdit && (
            <p className="text-xs text-muted-foreground">
              Route {position} of {sortedRoutes.length}. Its position stays
              unchanged.
            </p>
          )}
        </header>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.65fr)]">
          <div className="space-y-3">
            <MatchersEditor
              label="When an alert matches"
              value={matchers}
              onChange={setMatchers}
            />
            {(orderWarning || matchers.length === 0) && (
              <div
                className={cn(
                  "flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs",
                  toneText({ tone: "warning" }),
                )}
              >
                <TriangleAlert
                  aria-hidden
                  className="mt-0.5 size-3.5 shrink-0"
                />
                <p>
                  {orderWarning ??
                    "With no conditions, this route matches every alert. Keep it last unless later routes should be unreachable."}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="route-receiver">Send to receiver</Label>
              {receivers.length > 0 ? (
                <OptionCombobox
                  id="route-receiver"
                  value={receiver}
                  onChange={setReceiver}
                  placeholder="Pick a receiver"
                  options={receivers.map((candidate) => ({
                    value: candidate.name,
                    label: candidate.name,
                  }))}
                />
              ) : (
                <Input
                  id="route-receiver"
                  value={receiver}
                  onChange={(event) => setReceiver(event.target.value)}
                  placeholder="oncall"
                />
              )}
            </div>
            <Label className="flex items-center gap-2">
              <Switch
                checked={continueFlag}
                onCheckedChange={setContinueFlag}
              />
              Continue matching later routes
            </Label>
            <PreviewLine>
              Alerts where <strong>{matchersPhrase(matchers)}</strong>{" "}
              <ArrowRight className="inline size-3 text-muted-foreground" />{" "}
              notify <strong>{receiver || "a receiver"}</strong>.
            </PreviewLine>
          </div>
        </div>

        <Collapsible open={timingOpen} onOpenChange={setTimingOpen}>
          <CcDisclosureTrigger open={timingOpen}>
            <span className="text-xs font-medium">Timing</span>
            <span className="hidden min-w-0 truncate font-mono text-[0.6875rem] text-muted-foreground sm:block">
              {ccRouteTimingSummary(
                {
                  groupBy,
                  groupWaitSecs: wait.value,
                  groupIntervalSecs: interval.value,
                  repeatIntervalSecs: repeat.value,
                },
                "effective",
              ).join(" · ")}
            </span>
          </CcDisclosureTrigger>
          <CollapsibleContent>
            <div className="space-y-3 rounded-b-md border-x border-b border-border/60 p-3">
              <div className="space-y-1.5">
                <Label htmlFor="route-group-by">
                  Group by{" "}
                  <span className="font-normal text-muted-foreground">
                    (empty uses the default: {CC_DEFAULT_GROUP_BY.join(", ")})
                  </span>
                </Label>
                <TagsInput
                  aria-label="Group by labels"
                  placeholder={CC_DEFAULT_GROUP_BY.join(", ")}
                  value={groupBy}
                  onValueChange={setGroupBy}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <DurationField
                  id="route-group-wait"
                  label="Group wait (s)"
                  placeholder={String(CC_DEFAULT_GROUP_WAIT_SECS)}
                  value={groupWait}
                  onChange={setGroupWait}
                  error={wait.error}
                />
                <DurationField
                  id="route-group-interval"
                  label="Group interval (s)"
                  placeholder={String(CC_DEFAULT_GROUP_INTERVAL_SECS)}
                  value={groupInterval}
                  onChange={setGroupInterval}
                  error={interval.error}
                />
                <DurationField
                  id="route-repeat-interval"
                  label="Repeat interval (s)"
                  placeholder="never"
                  value={repeatInterval}
                  onChange={setRepeatInterval}
                  error={repeat.error}
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <footer className="flex flex-col-reverse gap-2 border-t border-border/60 pt-3 sm:flex-row sm:justify-end [&_[data-slot=button]]:h-10 sm:[&_[data-slot=button]]:h-8">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!receiver || hasErrors || save.isPending}
          >
            {save.isPending && (
              <LoaderCircle aria-hidden className="motion-safe:animate-spin" />
            )}
            {save.isPending
              ? "Saving..."
              : isEdit
                ? "Save changes"
                : "Create route"}
          </Button>
        </footer>
      </form>
    </li>
  );
}
