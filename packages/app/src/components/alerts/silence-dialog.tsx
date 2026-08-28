import { Button } from "@everr/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@everr/ui/components/command";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@everr/ui/components/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { alertRuleOptionsOptions } from "@/data/alerting/triage/options";
import {
  type AlertRuleOption,
  SILENCE_DURATIONS,
} from "@/data/alerting/triage/view";

/** What a silence starts from. A rule when the row that opened the dialog is
 *  one; `null` where there is no rule to assume, and the dialog offers the
 *  choice itself. Matchers and comment are what a repeat of a closed silence
 *  carries over; a fresh silence leaves them empty. */
export type SilenceSeed = {
  rule: string | null;
  matchers: string;
  comment: string;
};

/** What the dialog hands back: the input of `silenceAlertRule`, so neither
 *  caller translates it. */
export type SilenceDraft = {
  path: string;
  durationMinutes: number;
  matchers: string;
  comment: string;
};

type SilenceDuration = (typeof SILENCE_DURATIONS)[number];

/** An hour. */
const DEFAULT_DURATION: SilenceDuration = SILENCE_DURATIONS[1];

/**
 * The rule the silence is written against, by the name the rest of the product
 * calls it, grouped under its project and searchable.
 *
 * A plain select was fine for the handful of rules a demo org has and stops
 * being fine at the first customer: the list is every live rule, unbounded, and
 * it printed `project/slug` paths where triage prints display names. Search and
 * grouping come free from `Command`, and every path is already `project/slug`,
 * so the grouping needs no new data.
 *
 * Closed set, deliberately: `SuggestCombobox` would let a typed path through,
 * and a silence against a rule that does not exist mutes nothing while looking
 * like it mutes something.
 */
function RulePicker({
  id,
  value,
  rules,
  loading,
  onChange,
}: {
  id: string;
  value: string | null;
  rules: AlertRuleOption[];
  loading: boolean;
  onChange: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = rules.find((rule) => rule.path === value);
  // Insertion order of a Map is the order the groups were met, and the read
  // already sorted by project then slug, so the groups come out ordered
  // without a second sort. Memoized because this sits under the dialog's text
  // fields, and every character typed into them re-renders it.
  const groups = useMemo(() => {
    const byProject = new Map<string, AlertRuleOption[]>();
    for (const rule of rules) {
      const bucket = byProject.get(rule.project);
      if (bucket) bucket.push(rule);
      else byProject.set(rule.project, [rule]);
    }
    return [...byProject];
  }, [rules]);
  return (
    // The wrapper keeps Base UI's focus-guard spans, which are siblings of the
    // trigger while the popover is open, out of the field stack: in a `space-y`
    // parent their presence changes which child is last and shifts what
    // follows.
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={loading}
              className="h-9 w-full justify-between font-normal"
            />
          }
        >
          {selected ? (
            <span className="min-w-0 flex-1 truncate text-left text-sm">
              {selected.name}
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-left text-sm text-muted-foreground">
              {loading ? "Loading rules…" : "Choose a rule"}
            </span>
          )}
          <ChevronDownIcon
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--anchor-width) p-0">
          <Command className="p-0">
            <CommandInput placeholder="Search rules…" />
            <CommandList>
              <CommandEmpty>No rule matches.</CommandEmpty>
              {groups.map(([project, items]) => (
                <CommandGroup key={project} heading={project}>
                  {items.map((rule) => (
                    <CommandItem
                      // Searched against both, so typing either the name a
                      // reader knows or the path they pasted finds the rule.
                      key={rule.path}
                      value={`${rule.name} ${rule.path}`}
                      data-checked={rule.path === value || undefined}
                      onSelect={() => {
                        onChange(rule.path);
                        setOpen(false);
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{rule.name}</span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {rule.path}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Silencing is the one destructive-ish act available from triage, so it asks
 * before it acts and says what it will and will not stop. Three fields, all of
 * them defaulted: a duration (silences always expire), matchers (empty means
 * the whole rule) and a comment (`comment`/`author` are columns on the silence
 * row, and an unexplained silence is how alerting rots).
 */
export function SilenceDialog({
  seed,
  instanceCount = 0,
  pending,
  onClose,
  onConfirm,
}: {
  /** What this opening starts from; `null` while the dialog is closed. */
  seed: SilenceSeed | null;
  /** How many instances the rule currently has, for the matcher preview.
   *  Only the triage screen knows; elsewhere the preview names the scope. */
  instanceCount?: number;
  /** The silence is being written. The dialog stays open and inert until the
   *  server answers: closing early would leave the reader unsure it happened. */
  pending: boolean;
  onClose: () => void;
  onConfirm: (draft: SilenceDraft) => void;
}) {
  return (
    <Dialog
      open={seed !== null}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      {seed && (
        // Remounted per opening, so the fields start from whatever seeded
        // this one instead of holding the last opening's text. A `key` says
        // that in one line; syncing props into state with an effect would be
        // the same fact, spelled as a bug.
        <SilenceForm
          key={JSON.stringify(seed)}
          seed={seed}
          instanceCount={instanceCount}
          pending={pending}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      )}
    </Dialog>
  );
}

function SilenceForm({
  seed,
  instanceCount,
  pending,
  onClose,
  onConfirm,
}: {
  seed: SilenceSeed;
  instanceCount: number;
  pending: boolean;
  onClose: () => void;
  onConfirm: (draft: SilenceDraft) => void;
}) {
  // Whether this opening has a rule to pick. A row that opened the dialog
  // named one; the Silences page's own button did not, and the dialog offers
  // the choice itself.
  const choosing = seed.rule === null;
  // Only fetched when there is a choice to offer: with a rule in hand the
  // list is never read.
  const choices = useQuery({ ...alertRuleOptionsOptions(), enabled: choosing });
  // The whole entry, not its label: the confirm hands on `minutes`, and
  // nothing has to turn a label back into a number on the way out.
  const [duration, setDuration] = useState<SilenceDuration>(DEFAULT_DURATION);
  const [rulePath, setRulePath] = useState(seed.rule);
  const [matchers, setMatchers] = useState(seed.matchers);
  const [comment, setComment] = useState(seed.comment);

  // A degraded rule has no instances to count, so the preview names the scope
  // rather than claiming it matches nothing.
  const scope = matchers.trim()
    ? `matches instances where ${matchers.trim()}`
    : instanceCount > 0
      ? `matches all ${instanceCount} instances`
      : "matches the whole rule";

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        {/* Named for what it makes, not for what it acts on. Opened from a
            firing row it silences that alert; opened from the Silences page it
            writes a new silence, and the title that came with it from triage
            named the wrong noun in its new home. */}
        <DialogTitle>{choosing ? "New silence" : "Silence alert"}</DialogTitle>
        <DialogDescription>
          Notifications stop. The rule keeps evaluating, and held notifications
          are marked <span className="font-mono">suppressed</span>.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={choosing ? "silence-rule" : undefined}>Rule</Label>
          {choosing ? (
            <RulePicker
              id="silence-rule"
              value={rulePath}
              rules={choices.data ?? []}
              loading={choices.isPending}
              onChange={setRulePath}
            />
          ) : (
            <p className="font-mono text-sm">{seed.rule}</p>
          )}
        </div>

        <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="silence-duration">Duration</Label>
            <Select
              value={duration.label}
              onValueChange={(v) =>
                setDuration(
                  SILENCE_DURATIONS.find((d) => d.label === v) ??
                    DEFAULT_DURATION,
                )
              }
            >
              <SelectTrigger id="silence-duration" className="w-full">
                <SelectValue>{duration.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SILENCE_DURATIONS.map((d) => (
                  <SelectItem key={d.label} value={d.label}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="silence-matchers">Matchers</Label>
            <Input
              id="silence-matchers"
              value={matchers}
              onChange={(e) => setMatchers(e.target.value)}
              placeholder="empty = whole rule"
              autoComplete="off"
              aria-describedby="silence-matchers-help"
            />
          </div>
        </div>
        {/* Both fields answer the same question ("what am I about to turn
              off, and until when?"), so one line answers it under both rather
              than two hints splitting the reader's attention. */}
        <p className="text-xs text-muted-foreground">
          Silences for {duration.label} · {scope}
        </p>
        {/* The field asks for a syntax the page never showed. One real example
            is what a reader needs here: the shape of a matcher, that several
            are space-separated, and that a negation exists. */}
        <p id="silence-matchers-help" className="text-xs text-muted-foreground">
          Matchers are <span className="font-mono">label=value</span>, space
          separated. <span className="font-mono">!=</span> excludes. Example:{" "}
          <span className="font-mono">region=eu-west-1 service!=search</span>
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="silence-comment">Comment</Label>
          <Input
            id="silence-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Why this is silenced"
            autoComplete="off"
          />
        </div>
      </div>

      <DialogFooter>
        {/* A disabled primary that says nothing is a dead end. The one reason
            it can be disabled is the one thing the reader has not done yet, so
            the footer says it rather than leaving them to guess. */}
        {choosing && rulePath === null && (
          <p
            id="silence-confirm-help"
            className="mr-auto self-center text-xs text-muted-foreground"
          >
            Choose a rule first.
          </p>
        )}
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          disabled={pending || rulePath === null}
          aria-describedby={
            choosing && rulePath === null ? "silence-confirm-help" : undefined
          }
          onClick={() => {
            if (rulePath)
              onConfirm({
                path: rulePath,
                durationMinutes: duration.minutes,
                matchers,
                comment,
              });
          }}
        >
          {pending ? "Silencing…" : `Silence for ${duration.label}`}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
