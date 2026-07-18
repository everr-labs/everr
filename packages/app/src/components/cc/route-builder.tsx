// packages/app/src/components/cc/route-builder.tsx
//
// Backs the /alerts/delivery page's pipeline: create/edit one route in the
// shared drawer so the pipeline stays visible while editing.
import { Button } from "@everr/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
} from "@everr/ui/components/collapsible";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import { Switch } from "@everr/ui/components/switch";
import { TagsInput } from "@everr/ui/components/tags-input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  CcConceptNote,
  CcDisclosureTrigger,
  ccErrorMessage,
} from "@/components/cc/shared";
import {
  CC_DEFAULT_GROUP_BY,
  CC_DEFAULT_GROUP_INTERVAL_SECS,
  CC_DEFAULT_GROUP_WAIT_SECS,
} from "@/data/cc/defaults";
import { createCcRoute, updateCcRoute } from "@/data/cc/server";
import type { CcMatcher, CcReceiver, CcRoute } from "@/data/cc/types";
import { CcDrawer } from "./cc-drawer";
import { MatchersEditor, matchersPhrase } from "./matchers-editor";

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
    <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed [&_strong]:font-medium [&_strong]:text-foreground">
      {children}
    </div>
  );
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

/**
 * One-line effective timing readout: the route's values where set, the
 * engine's defaults where not — what the dispatcher will actually do.
 */
function effectiveTimingSummary({
  groupBy,
  groupWaitSecs,
  groupIntervalSecs,
  repeatIntervalSecs,
}: {
  groupBy: string[];
  groupWaitSecs: number | null;
  groupIntervalSecs: number | null;
  repeatIntervalSecs: number | null;
}): string {
  const parts = [
    `wait ${groupWaitSecs ?? CC_DEFAULT_GROUP_WAIT_SECS}s`,
    `interval ${groupIntervalSecs ?? CC_DEFAULT_GROUP_INTERVAL_SECS}s`,
    `repeat ${repeatIntervalSecs != null ? `${repeatIntervalSecs}s` : "never"}`,
    `group by ${(groupBy.length > 0 ? groupBy : CC_DEFAULT_GROUP_BY).join(", ")}`,
  ];
  return parts.join(" · ");
}

export function RouteBuilder({
  open,
  onOpenChange,
  receivers,
  route,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  receivers: CcReceiver[];
  route: CcRoute | null;
}) {
  const qc = useQueryClient();
  const isEdit = route !== null;
  const [matchers, setMatchers] = useState<CcMatcher[]>(route?.matchers ?? []);
  const [receiver, setReceiver] = useState(route?.receiver ?? "");
  const [priority, setPriority] = useState(route?.priority ?? 0);
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

  const save = useMutation({
    mutationFn: () => {
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
      return isEdit
        ? updateCcRoute({ data: { id: route.id, input } })
        : createCcRoute({ data: input });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cc", "routes"] });
      onOpenChange(false);
      toast.success(isEdit ? "Route updated" : "Route created");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  return (
    <CcDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit route" : "New route"}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!receiver || hasErrors || save.isPending}
            onClick={() => save.mutate()}
          >
            {isEdit ? "Save changes" : "Create route"}
          </Button>
        </>
      }
    >
      <CcConceptNote>
        A route sends matching alerts to one receiver. Lower priority numbers
        are checked first; the first matching route wins.
      </CcConceptNote>
      <MatchersEditor
        label="When an alert matches"
        value={matchers}
        onChange={setMatchers}
      />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="route-receiver">Send to receiver</Label>
          {receivers.length > 0 ? (
            <Select
              value={receiver}
              onValueChange={(v) => setReceiver(v ?? "")}
            >
              <SelectTrigger id="route-receiver" className="w-full">
                <SelectValue placeholder="Pick a receiver" />
              </SelectTrigger>
              <SelectContent>
                {receivers.map((r) => (
                  <SelectItem key={r.name} value={r.name}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="route-receiver"
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              placeholder="oncall"
            />
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="route-priority">Priority</Label>
          <Input
            id="route-priority"
            type="number"
            className="tabular-nums"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          />
        </div>
      </div>
      <Label className="flex items-center gap-2">
        <Switch checked={continueFlag} onCheckedChange={setContinueFlag} />
        Continue matching later rules
      </Label>
      {/* Grouping/repeat cadence is a tuning concern, not a routing decision:
          collapsed by default, with the effective values (engine defaults
          where unset) always readable on the trigger line. */}
      <Collapsible open={timingOpen} onOpenChange={setTimingOpen}>
        <CcDisclosureTrigger open={timingOpen}>
          <span className="text-xs font-medium">Timing</span>
          <span className="min-w-0 truncate font-mono text-[0.6875rem] text-muted-foreground">
            {effectiveTimingSummary({
              groupBy,
              groupWaitSecs: wait.value,
              groupIntervalSecs: interval.value,
              repeatIntervalSecs: repeat.value,
            })}
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
            <div className="grid grid-cols-3 gap-3">
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
      <PreviewLine>
        Alerts where <strong>{matchersPhrase(matchers)}</strong>{" "}
        <ArrowRight className="inline size-3 text-muted-foreground" /> notify{" "}
        <strong>{receiver || "a receiver"}</strong>.
      </PreviewLine>
    </CcDrawer>
  );
}
