import { Button } from "@everr/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { cn } from "@everr/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, ChevronDown, Loader2 } from "lucide-react";
import { useCallback } from "react";
import { ALL_VALUE } from "@/data/dashboards/interpolate";
import type {
  ListVariable,
  TextVariable,
  Variable,
} from "@/data/dashboards/schema";
import {
  useDashboardVariables,
  type VariableOptionsState,
} from "./use-dashboard-variables";

function variableLabel(variable: Variable): string {
  return variable.spec.display?.name ?? variable.spec.name;
}

function isVisible(variable: Variable): boolean {
  if (variable.spec.display?.hidden) return false;
  // Constant text variables are fixed values — nothing to pick.
  if (variable.kind === "TextVariable" && variable.spec.constant) return false;
  return true;
}

interface VariableBarProps {
  /** Compact styling for the panel editor header. */
  compact?: boolean;
}

export function VariableBar({ compact }: VariableBarProps) {
  const navigate = useNavigate();
  const { variables, values, optionsState } = useDashboardVariables();

  const setValue = useCallback(
    (name: string, value: string | string[]) => {
      navigate({
        to: ".",
        search: (prev) => ({
          ...prev,
          vars: {
            ...(prev.vars ?? {}),
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

  return (
    <div
      className={cn(
        "flex flex-wrap items-end gap-3",
        compact ? "border-b px-4 py-2" : "mb-3",
      )}
    >
      {visible.map((variable) =>
        variable.kind === "TextVariable" ? (
          <TextVariableField
            key={variable.spec.name}
            variable={variable}
            value={
              typeof values[variable.spec.name] === "string"
                ? (values[variable.spec.name] as string)
                : ""
            }
            onCommit={(value) => setValue(variable.spec.name, value)}
          />
        ) : (
          <ListVariableField
            key={variable.spec.name}
            variable={variable}
            value={values[variable.spec.name]}
            optionsState={optionsState[variable.spec.name]}
            onChange={(value) => setValue(variable.spec.name, value)}
          />
        ),
      )}
    </div>
  );
}

function TextVariableField({
  variable,
  value,
  onCommit,
}: {
  variable: TextVariable;
  value: string;
  onCommit: (value: string) => void;
}) {
  const name = variable.spec.name;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`var-${name}`} className="text-xs text-muted-foreground">
        {variableLabel(variable)}
      </Label>
      <Input
        id={`var-${name}`}
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
  value,
  optionsState,
  onChange,
}: {
  variable: ListVariable;
  value: string | string[] | undefined;
  optionsState: VariableOptionsState | undefined;
  onChange: (value: string | string[]) => void;
}) {
  const name = variable.spec.name;
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

  const triggerLabel = error
    ? "Error"
    : isPending
      ? "Loading…"
      : isAll
        ? "All"
        : selected.length === 0
          ? "Select…"
          : selected.join(", ");

  // Toggling an individual option clears All; selecting All clears individuals.
  const handleToggle = (option: string, checked: boolean) => {
    const base = isAll ? [] : selected;
    onChange(checked ? [...base, option] : base.filter((o) => o !== option));
  };

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`var-${name}`} className="text-xs text-muted-foreground">
        {variableLabel(variable)}
      </Label>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              id={`var-${name}`}
              variant="outline"
              size="sm"
              disabled={isPending}
              title={error}
              className={cn(
                "h-8 max-w-56 justify-between font-normal",
                error && "border-destructive text-destructive",
              )}
            />
          }
        >
          <span className="truncate">{triggerLabel}</span>
          {isPending ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : error ? (
            <AlertCircle className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {allowAll && (
            <>
              {multi ? (
                <DropdownMenuCheckboxItem
                  checked={isAll}
                  onCheckedChange={() => onChange(ALL_VALUE)}
                >
                  All
                </DropdownMenuCheckboxItem>
              ) : (
                <DropdownMenuItem onClick={() => onChange(ALL_VALUE)}>
                  All
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}
          {(options ?? []).map((option) =>
            multi ? (
              <DropdownMenuCheckboxItem
                key={option}
                checked={!isAll && selected.includes(option)}
                closeOnClick={false}
                onCheckedChange={(checked) => handleToggle(option, checked)}
              >
                {option}
              </DropdownMenuCheckboxItem>
            ) : (
              <DropdownMenuItem key={option} onClick={() => onChange(option)}>
                {option}
              </DropdownMenuItem>
            ),
          )}
          {truncated && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              First 1000 shown
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
