import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@everr/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@everr/ui/components/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@everr/ui/components/tooltip";
import { cn } from "@everr/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, type RefObject, useRef, useState } from "react";
import type { metricNamesOptions } from "../data/options";
import type { MetricType } from "../data/schemas";
import { METRIC_LIST_LIMIT, metricKind } from "../data/types";
import { formatCount } from "./format";
import { MetricKindLabel } from "./metric-name";

/** What a chart's metric name opens: the metrics in range, to switch to another. */
export interface MetricPickerProps {
  /** The metrics in range, fetched when the list first opens. */
  metrics: ReturnType<typeof metricNamesOptions>;
  value: { name: string; type: MetricType | undefined };
  onChange: (metric: { name: string; type: MetricType }) => void;
  /** The button's id, so the page can move focus to it. */
  triggerId?: string;
}

const key = (name: string, type: MetricType | undefined) => `${type ?? ""}:${name}`;

/**
 * The metric's name as a button that opens a searchable list of metrics.
 * `details` shows on hover, until the list opens.
 */
export function MetricPicker({
  metrics,
  value,
  onChange,
  triggerId,
  onOpen,
  anchor,
  label,
  details,
  className,
  children,
}: MetricPickerProps & {
  onOpen?: () => void;
  /** What the list opens under, when not the name itself. */
  anchor?: RefObject<HTMLElement | null>;
  label: string;
  details?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const list = useQuery({ ...metrics, enabled: open });
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const current = key(value.name, value.type);

  const trigger = (
    <PopoverTrigger
      render={
        <button
          type="button"
          id={triggerId}
          aria-label={label}
          className={cn(
            "hover:bg-muted aria-expanded:bg-muted flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md text-left",
            className,
          )}
        />
      }
    >
      {children}
      <ChevronDown className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
    </PopoverTrigger>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setTooltipOpen(false);
          onOpen?.();
        }
      }}
    >
      {details ? (
        <Tooltip open={tooltipOpen && !open} onOpenChange={setTooltipOpen}>
          <TooltipTrigger render={trigger} />
          <TooltipContent className="flex max-w-80 flex-col gap-1">{details}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <PopoverContent align="start" anchor={anchor} className="w-96 p-0">
        <Command className="p-0">
          <CommandInput ref={search} placeholder="Search metrics…" />
          <CommandList>
            <CommandEmpty>
              {list.data ? (
                "No metric matches."
              ) : list.error && !list.isFetching ? (
                <>
                  {"Couldn't load metrics. "}
                  <button
                    type="button"
                    className="cursor-pointer underline"
                    onClick={() => {
                      // The button gives way to the list, so focus moves to its search.
                      search.current?.focus();
                      void list.refetch();
                    }}
                    onKeyDown={(event) => {
                      // The list takes Enter to pick an item and cancels it everywhere else.
                      if (event.key === "Enter") event.stopPropagation();
                    }}
                  >
                    Retry
                  </button>
                </>
              ) : (
                "Loading…"
              )}
            </CommandEmpty>
            {(list.data ?? []).map((m) => (
              <CommandItem
                key={key(m.name, m.type)}
                value={key(m.name, m.type)}
                keywords={[m.name]}
                data-checked={key(m.name, m.type) === current || undefined}
                onSelect={() => {
                  setOpen(false);
                  if (key(m.name, m.type) !== current) onChange({ name: m.name, type: m.type });
                }}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{m.name}</span>
                <MetricKindLabel kind={metricKind(m.type, m.isMonotonic)} />
              </CommandItem>
            ))}
            {(list.data?.length ?? 0) >= METRIC_LIST_LIMIT ? (
              <p className="text-muted-foreground px-2 py-1.5 text-xs">
                {`Only the first ${formatCount(METRIC_LIST_LIMIT)} metrics by name. Find the rest in the catalog.`}
              </p>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
