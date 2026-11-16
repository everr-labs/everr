/* oxlint-disable typescript/consistent-type-assertions -- These erased assertions describe existing trusted data and library contracts; runtime validation would change behavior. */
import { Spinner } from "@everr/ui/components/spinner";
import { Button } from "@everr/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@everr/ui/components/command";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@everr/ui/components/popover";
import { cn } from "@everr/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, ChevronDown } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { ALL_VALUE } from "#app/data/dashboards/interpolate.ts";
import type { ListVariable, TextVariable, Variable } from "#app/data/dashboards/schema.ts";
import { useDashboardVariables, type VariableOptionsState } from "./use-dashboard-variables";

// Inline fields carry their own left-hairline separator. Drawn as a border
// (not an interleaved element) so a wrapped row can never start or end with a
// dangling divider: the bar's negative margin pulls every row's first border
// outside the clipping wrapper.
const fieldClass = (layout: VariableBarLayout) =>
  layout === "inline"
    ? "flex items-center gap-2 border-border/70 border-l pl-3"
    : "flex flex-col gap-1";

function variableLabel(variable: Variable): string {
  return variable.spec.display?.name ?? variable.spec.name;
}

function isVisible(variable: Variable): boolean {
  if (variable.spec.display?.hidden) return false;
  // Constant text variables are fixed values — nothing to pick.
  if (variable.kind === "TextVariable" && variable.spec.constant) return false;
  return true;
}

/**
 * Whether this dashboard shows any pickers at all. A container that seats the
 * variable bar next to other controls has to know before it renders: with no
 * pickers there is no left half, so there is nothing to divide.
 */
export function useHasVisibleVariables(): boolean {
  return useDashboardVariables().variables.some(isVisible);
}

/**
 * `inline` puts each label beside its control instead of above it, so every
 * item in the row shares one control-height baseline. The dashboard toolbar
 * needs that to align its actions against; the runbook viewer renders this as a
 * standalone block, where the stacked label reads better, and keeps the default.
 */
export type VariableBarLayout = "stacked" | "inline";

export function VariableBar({ layout = "stacked" }: { layout?: VariableBarLayout }) {
  // Unique per bar: the toolbar renders a second one in its Filters popover.
  const idPrefix = useId();
  const navigate = useNavigate();
  const { variables, values, optionsState } = useDashboardVariables();

  const setValue = useCallback(
    (name: string, value: string | string[]) => {
      void navigate({
        to: ".",
        search: (prev) => ({
          ...prev,
          vars: {
            ...(prev.vars as Record<string, string | string[]> | undefined),
            [name]: value,
          },
        }),
        replace: false,
      });
    },
    [navigate],
  );

  const visible = variables.filter(isVisible);
  if (visible.length === 0) return null;

  const fields = (
    <div
      className={cn(
        "flex flex-wrap gap-3",
        layout === "inline"
          ? // The negative margin pulls every wrapped row's first field
            // hairline (`fieldClass`: pl-3 + 1px border = 13px) outside the
            // clipping wrapper below, so no row starts or ends with a
            // dangling divider.
            "-ml-[13px] items-center"
          : "mb-3 items-end",
      )}
    >
      {visible.map((variable) => {
        const currentValue = values[variable.spec.name];
        return variable.kind === "TextVariable" ? (
          <TextVariableField
            key={variable.spec.name}
            variable={variable}
            layout={layout}
            id={`${idPrefix}-${variable.spec.name}`}
            value={typeof currentValue === "string" ? currentValue : ""}
            onCommit={(value) => setValue(variable.spec.name, value)}
          />
        ) : (
          <ListVariableField
            key={variable.spec.name}
            variable={variable}
            layout={layout}
            id={`${idPrefix}-${variable.spec.name}`}
            value={values[variable.spec.name]}
            optionsState={optionsState[variable.spec.name]}
            onChange={(value) => setValue(variable.spec.name, value)}
          />
        );
      })}
    </div>
  );

  if (layout !== "inline") return fields;
  // Inline mode is self-contained: the clip that makes the per-field
  // hairlines work lives here, not in whichever parent seats the bar. Only
  // the left edge, where the hairlines sit, is clipped: the other sides grow
  // past the box so a control's focus ring is not cut.
  return <div className="[clip-path:inset(-8px_-8px_-8px_0)]">{fields}</div>;
}

function TextVariableField({
  variable,
  layout,
  id,
  value,
  onCommit,
}: {
  variable: TextVariable;
  layout: VariableBarLayout;
  id: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  return (
    <div className={fieldClass(layout)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {variableLabel(variable)}
      </Label>
      <Input
        id={id}
        key={value}
        defaultValue={value}
        className="h-8 w-40"
        onBlur={(e) => {
          if (e.target.value !== value) onCommit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </div>
  );
}

function ListVariableField({
  variable,
  layout,
  id,
  value,
  optionsState,
  onChange,
}: {
  variable: ListVariable;
  layout: VariableBarLayout;
  id: string;
  value: string | string[] | undefined;
  optionsState: VariableOptionsState | undefined;
  onChange: (value: string | string[]) => void;
}) {
  const multi = variable.spec.allowMultiple === true;
  const allowAll = variable.spec.allowAllValue === true;
  const { options, isPending, error, truncated } = optionsState ?? {
    isPending: false,
  };

  const isAll = value === ALL_VALUE;
  const selected = Array.isArray(value)
    ? value
    : typeof value === "string" && !isAll
      ? [value]
      : [];

  // The effective value never depends on the options (URL wins, then spec
  // defaults), so option loading must not blank it: swapping a known "All"
  // for a disabled "Loading…" made every dashboard navigation flicker. The
  // spinner icon carries the pending state; the menu shows it too.
  const triggerLabel = error
    ? "Error"
    : isAll
      ? "All"
      : selected.length === 0
        ? "Select…"
        : selected.length === 1
          ? selected[0]
          : `${selected[0]} +${selected.length - 1}`;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setSearch("");
  };

  // A single value closes the list on a pick; a multi-value list stays open
  // while options are toggled, like the explore filters.
  const pick = (next: string) => {
    onChange(next);
    handleOpenChange(false);
  };

  // Toggling an individual option clears All; selecting All clears individuals.
  const handleToggle = (option: string, checked: boolean) => {
    const base = isAll ? [] : selected;
    onChange(checked ? [...base, option] : base.filter((o) => o !== option));
  };

  return (
    <div className={fieldClass(layout)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {variableLabel(variable)}
      </Label>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              variant="outline"
              size="sm"
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/role-has-required-aria-props -- Rich combobox trigger; PopoverTrigger supplies the popup association.
              role="combobox"
              aria-expanded={open}
              title={error ?? (selected.length > 0 ? selected.join(", ") : undefined)}
              className={cn(
                "h-8 max-w-56 justify-between font-normal",
                error && "border-destructive text-destructive",
              )}
            />
          }
        >
          <span className="truncate">{triggerLabel}</span>
          {isPending ? (
            <Spinner className="size-3.5 text-muted-foreground" />
          ) : error ? (
            <AlertCircle className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto min-w-(--anchor-width) max-w-80 p-0">
          <Command className="p-0 *-data-[slot=command-input-wrapper]:p-0">
            <CommandInput
              wrapperClassName="p-0 border-b"
              inputGroupClassName="border-none rounded-none bg-transparent h-8"
              placeholder="Search..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList className="max-h-80">
              <CommandEmpty>{isPending ? "Loading options…" : "No results."}</CommandEmpty>
              <CommandGroup>
                {allowAll && (
                  <CommandItem
                    value={ALL_VALUE}
                    keywords={["All"]}
                    data-checked={isAll || undefined}
                    onSelect={() => (multi ? onChange(isAll ? [] : ALL_VALUE) : pick(ALL_VALUE))}
                  >
                    All
                  </CommandItem>
                )}
                {(options ?? []).map((option) => {
                  const checked = !isAll && selected.includes(option);
                  return (
                    <CommandItem
                      key={option}
                      value={option}
                      data-checked={checked || undefined}
                      onSelect={() => (multi ? handleToggle(option, !checked) : pick(option))}
                    >
                      <span className="truncate" title={option}>
                        {option}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
            {isPending && (options?.length ?? 0) > 0 && (
              <div className="text-muted-foreground border-t px-3 py-1.5 text-xs">
                Loading options…
              </div>
            )}
            {truncated && (
              <div className="text-muted-foreground border-t px-3 py-1.5 text-xs">
                First 1000 shown
              </div>
            )}
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
