// packages/app/src/components/cc/route-builder.tsx
//
// Backs the /alerts/routing page's "Routes" section.
import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
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
import { CcConceptNote, ccErrorMessage } from "@/components/cc/shared";
import { createCcRoute, updateCcRoute } from "@/data/cc/server";
import type { CcMatcher, CcReceiver, CcRoute } from "@/data/cc/types";
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit route" : "New route"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <CcConceptNote>
            A route sends matching alerts to one receiver. Lower priority
            numbers are checked first; the first matching route wins.
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
          <div className="space-y-1.5">
            <Label htmlFor="route-group-by">
              Group by{" "}
              <span className="font-normal text-muted-foreground">
                (empty uses the default: rule, severity)
              </span>
            </Label>
            <TagsInput
              aria-label="Group by labels"
              placeholder="rule, severity"
              value={groupBy}
              onValueChange={setGroupBy}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <DurationField
              id="route-group-wait"
              label="Group wait (s)"
              placeholder="10"
              value={groupWait}
              onChange={setGroupWait}
              error={wait.error}
            />
            <DurationField
              id="route-group-interval"
              label="Group interval (s)"
              placeholder="300"
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
          <Label className="flex items-center gap-2">
            <Switch checked={continueFlag} onCheckedChange={setContinueFlag} />
            Continue matching later rules
          </Label>
          <PreviewLine>
            Alerts where <strong>{matchersPhrase(matchers)}</strong>{" "}
            <ArrowRight className="inline size-3 text-muted-foreground" />{" "}
            notify <strong>{receiver || "a receiver"}</strong>.
          </PreviewLine>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!receiver || hasErrors || save.isPending}
            onClick={() => save.mutate()}
          >
            {isEdit ? "Save changes" : "Create route"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
