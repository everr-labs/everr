import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { DEFAULT_TIME_RANGE } from "@everr/ui/lib/time-range";
import { cn } from "@everr/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, type LinkProps, useMatchRoute } from "@tanstack/react-router";
import {
  Activity,
  Boxes,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Cpu,
  Database,
  Globe,
  RotateCw,
  SearchIcon,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { evaluateBuiltin } from "@/data/dashboards/built-in/capabilities";
import { BUILTIN_DASHBOARDS } from "@/data/dashboards/built-in/catalog";
import type {
  BuiltinCategory,
  BuiltinDashboard,
} from "@/data/dashboards/built-in/types";
import {
  dashboardListOptions,
  telemetryCapabilitiesOptions,
} from "@/data/dashboards/options";
import {
  readBuiltinsCollapsed,
  writeBuiltinsCollapsed,
} from "@/data/dashboards/ui-prefs";
import {
  DashboardTree,
  railRowActiveProps,
  railRowClass,
} from "./dashboard-tree";

const CATEGORY_ICON: Record<
  BuiltinCategory,
  React.ComponentType<{ className?: string }>
> = {
  Application: Activity,
  Runtime: Cpu,
  Databases: Database,
  Infrastructure: Boxes,
  Browser: Globe,
};

/**
 * The one list of Dashboards: the user's own first (their folder tree
 * preserved), then every Built-in dashboard, ready ones before the ones whose
 * telemetry has not been seen recently.
 */
export function DashboardsList({ preview }: { preview?: string }) {
  const [search, setSearch] = useState("");
  // null = automatic: collapsed by default (the unready tail is reference
  // material, not the menu), but opened when nothing at all is ready, because
  // then the tail is the whole built-in story. A click makes it user-owned.
  const [needsDataOpen, setNeedsDataOpen] = useState<boolean | null>(null);
  const [builtinsCollapsed, setBuiltinsCollapsed] = useState(
    readBuiltinsCollapsed,
  );

  const listQuery = useQuery(dashboardListOptions(preview));
  const dashboards = listQuery.data ?? [];

  // Probed over a fixed window, not the picker's: every dashboard sets its own
  // time defaults on open, so a range-keyed probe would reshuffle
  // ready/needs-data on every navigation. The list answers "do you send this
  // at all"; the open built-in's own notice grades the on-screen range.
  // While the group is collapsed nothing renders the grading, so the probe
  // waits until it is expanded.
  const capabilitiesQuery = useQuery({
    ...telemetryCapabilitiesOptions(
      DEFAULT_TIME_RANGE.from,
      DEFAULT_TIME_RANGE.to,
    ),
    enabled: !builtinsCollapsed,
  });
  const capabilities = capabilitiesQuery.data;

  // Until the probe answers, the built-in list stays empty: grading against
  // an empty result would label every built-in unready for a reason nothing
  // has established, and the list would paint a grouping it is about to
  // rearrange under the reader's cursor.
  const { matching, ready, needsData } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matching = !q
      ? BUILTIN_DASHBOARDS
      : BUILTIN_DASHBOARDS.filter(
          (builtin) =>
            builtin.name.toLowerCase().includes(q) ||
            builtin.description.toLowerCase().includes(q) ||
            builtin.category.toLowerCase().includes(q) ||
            // Requirements are searchable too: someone who knows they emit
            // `redis.*` should find the Redis built-in by typing what they
            // send.
            builtin.requires.some((r) =>
              (r.match ?? r.signal).toLowerCase().includes(q),
            ),
        );
    if (!capabilities) return { matching, ready: [], needsData: [] };
    const ready: BuiltinDashboard[] = [];
    const needsData: BuiltinDashboard[] = [];
    for (const builtin of matching) {
      const target =
        evaluateBuiltin(builtin, capabilities).status === "ready"
          ? ready
          : needsData;
      target.push(builtin);
    }
    return { matching, ready, needsData };
  }, [capabilities, search]);

  // A deep link can land on an unready built-in; no disclosure may hide the
  // active row, or the list stops saying where you are: a collapsed group
  // shows just that row. Matched by route identity rather than param shape,
  // so a future sibling route with a `slug` param cannot mis-detect.
  const matchRoute = useMatchRoute();
  const builtinMatch = matchRoute({ to: "/dashboards/built-in/$slug" });
  const activeBuiltin = builtinMatch ? builtinMatch.slug : undefined;
  const activeNeedsData = needsData.find(
    (builtin) => builtin.id === activeBuiltin,
  );
  const showNeedsData =
    needsDataOpen ??
    (capabilities !== undefined && ready.length === 0 && needsData.length > 0);
  const visibleNeedsData = showNeedsData
    ? needsData
    : activeNeedsData
      ? [activeNeedsData]
      : [];
  const activeMatching = matching.find(
    (builtin) => builtin.id === activeBuiltin,
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <div className="relative">
        <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search dashboards..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
          aria-label="Search dashboards"
        />
      </div>

      {/* Only the rows scroll; the search stays pinned above. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1 pb-3">
        <section aria-label="Your dashboards">
          <GroupLabel label="Your dashboards" />
          {listQuery.isLoading && (
            <p className="px-1 py-1 text-muted-foreground text-xs">
              Loading...
            </p>
          )}
          {listQuery.isError && (
            <p className="px-1 py-1 text-amber-400 text-xs">
              Couldn't load your dashboards
            </p>
          )}
          {!listQuery.isLoading &&
            !listQuery.isError &&
            dashboards.length === 0 && (
              <RailRow
                label="Create your first dashboard"
                icon={CirclePlus}
                to="/dashboards/get-started"
              />
            )}
          {dashboards.length > 0 && (
            <DashboardTree dashboards={dashboards} search={search} />
          )}
        </section>

        <section aria-label="Built-in dashboards">
          <GroupLabel
            label="Built-in dashboards"
            open={!builtinsCollapsed}
            onToggle={() => {
              const next = !builtinsCollapsed;
              setBuiltinsCollapsed(next);
              writeBuiltinsCollapsed(next);
            }}
          />

          {builtinsCollapsed ? (
            activeMatching && <BuiltinRow builtin={activeMatching} />
          ) : (
            <>
              {capabilitiesQuery.isError && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pb-1 text-xs">
                  <span className="inline-flex items-center gap-1.5 text-amber-400">
                    <TriangleAlert className="size-3.5" />
                    Couldn't check what you send
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => void capabilitiesQuery.refetch()}
                  >
                    <RotateCw className="size-3" />
                    Retry
                  </Button>
                </div>
              )}

              {matching.length === 0 && (
                <p className="px-1 py-1 text-muted-foreground text-xs">
                  No built-in matches that search.
                </p>
              )}

              {ready.map((builtin) => (
                <BuiltinRow key={builtin.id} builtin={builtin} />
              ))}

              {needsData.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setNeedsDataOpen(!showNeedsData)}
                    aria-expanded={showNeedsData}
                    title="Nothing sent in the last 7 days"
                    className="mt-2.5 mb-0.5 flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left font-medium text-[0.6875rem] text-muted-foreground/80 hover:text-foreground"
                  >
                    {showNeedsData ? (
                      <ChevronDown className="size-3 shrink-0" />
                    ) : (
                      <ChevronRight className="size-3 shrink-0" />
                    )}
                    Needs data
                    <span className="ml-1 tabular-nums opacity-80">
                      {needsData.length}
                    </span>
                  </button>
                  {visibleNeedsData.map((builtin) => (
                    <BuiltinRow key={builtin.id} builtin={builtin} />
                  ))}
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

const groupLabelClass =
  "font-semibold text-[0.6875rem] text-foreground/75 uppercase tracking-wider";

/** Static heading, or a disclosure toggle when `onToggle` is given. */
function GroupLabel({
  label,
  open,
  onToggle,
}: {
  label: string;
  open?: boolean;
  onToggle?: () => void;
}) {
  return (
    <header className="mb-1.5">
      {onToggle ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className={cn(
            groupLabelClass,
            "flex w-full items-center gap-1 rounded-md px-1 text-left hover:text-foreground",
          )}
        >
          {open ? (
            <ChevronDown className="size-3 shrink-0" />
          ) : (
            <ChevronRight className="size-3 shrink-0" />
          )}
          {label}
        </button>
      ) : (
        <h2 className={cn(groupLabelClass, "px-1")}>{label}</h2>
      )}
    </header>
  );
}

/** One rail row: the shared look of every navigable item in this list. */
function RailRow({
  label,
  icon: Icon,
  ...linkProps
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
} & LinkProps) {
  return (
    <Link
      {...linkProps}
      className={cn(
        railRowClass,
        "flex w-full items-center gap-2.5 px-2 text-left text-foreground",
      )}
      activeProps={railRowActiveProps}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
    </Link>
  );
}

function BuiltinRow({ builtin }: { builtin: BuiltinDashboard }) {
  return (
    <RailRow
      label={builtin.name}
      icon={CATEGORY_ICON[builtin.category]}
      to="/dashboards/built-in/$slug"
      params={{ slug: builtin.id }}
    />
  );
}
