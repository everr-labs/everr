import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { DEFAULT_TIME_RANGE } from "@everr/ui/lib/time-range";
import { cn } from "@everr/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import {
  Activity,
  Boxes,
  ChevronDown,
  ChevronRight,
  Cpu,
  Database,
  Globe,
  Loader2,
  RotateCw,
  SearchIcon,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  type BuiltinReadiness,
  evaluateBuiltin,
} from "@/data/dashboards/built-in/capabilities";
import { BUILTIN_DASHBOARDS } from "@/data/dashboards/built-in/catalog";
import type {
  BuiltinCategory,
  BuiltinDashboard,
} from "@/data/dashboards/built-in/types";
import {
  dashboardListOptions,
  telemetryCapabilitiesOptions,
} from "@/data/dashboards/options";
import { DashboardTree } from "./dashboard-tree";

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
 * A built-in plus what the probe can say about it. `readiness` is null until
 * the probe answers: grading against an empty result would label every
 * built-in unready for a reason nothing has established, and the list would
 * paint a grouping it is about to rearrange under the reader's cursor.
 */
interface Graded {
  builtin: BuiltinDashboard;
  readiness: BuiltinReadiness | null;
}

/**
 * The one list of Dashboards: the user's own first (their folder tree
 * preserved), then every Built-in dashboard, ready ones before the ones whose
 * telemetry has not been seen recently.
 */
export function DashboardsList({ preview }: { preview?: string }) {
  const [search, setSearch] = useState("");
  // Collapsed by default: the unready tail is reference material, not the
  // menu. The count keeps it discoverable.
  const [needsDataOpen, setNeedsDataOpen] = useState(false);

  const listQuery = useQuery(dashboardListOptions(preview));
  const dashboards = listQuery.data ?? [];

  // Probed over a fixed window, not the picker's: every dashboard sets its own
  // time defaults on open, so a range-keyed probe would reshuffle
  // ready/needs-data on every navigation. The list answers "do you send this
  // at all"; the open built-in's own notice grades the on-screen range.
  const capabilitiesQuery = useQuery(
    telemetryCapabilitiesOptions(
      DEFAULT_TIME_RANGE.from,
      DEFAULT_TIME_RANGE.to,
    ),
  );
  const capabilities = capabilitiesQuery.data;
  const graded = useMemo<Graded[]>(
    () =>
      BUILTIN_DASHBOARDS.map((builtin) => ({
        builtin,
        readiness: capabilities ? evaluateBuiltin(builtin, capabilities) : null,
      })),
    [capabilities],
  );

  const matching = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return graded;
    return graded.filter(
      ({ builtin }) =>
        builtin.name.toLowerCase().includes(q) ||
        builtin.description.toLowerCase().includes(q) ||
        builtin.category.toLowerCase().includes(q) ||
        // Requirements are searchable too: someone who knows they emit
        // `redis.*` should find the Redis built-in by typing what they send.
        builtin.requires.some((r) => r.match.toLowerCase().includes(q)),
    );
  }, [graded, search]);

  const ready = matching.filter((e) => e.readiness?.status === "ready");
  const needsData = matching.filter((e) => e.readiness?.status !== "ready");
  const ungraded = matching.some((e) => e.readiness === null);

  // A deep link can land on an unready built-in; the disclosure must not hide
  // the active row, or the list stops saying where you are. The built-in
  // route is the only one with a bare `slug` param (yours carry `project`).
  const params = useParams({ strict: false }) as {
    project?: string;
    slug?: string;
  };
  const activeBuiltin = params.project ? undefined : params.slug;
  const showNeedsData =
    needsDataOpen || needsData.some((e) => e.builtin.id === activeBuiltin);

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

      {/* Only the rows scroll; the heading and search stay pinned above. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:overflow-y-auto lg:pr-1 lg:pb-3">
        <section aria-label="Your dashboards">
          <GroupLabel label="Your dashboards" count={dashboards.length} />
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
              <p className="px-1 py-1 text-muted-foreground text-xs">
                None yet. Open a built-in below and fork it with your assistant.
              </p>
            )}
          {dashboards.length > 0 && (
            <DashboardTree dashboards={dashboards} search={search} />
          )}
        </section>

        <section aria-label="Built-in dashboards">
          <GroupLabel
            label="Built-in dashboards"
            count={BUILTIN_DASHBOARDS.length}
          />

          {capabilitiesQuery.isPending && (
            <p className="inline-flex items-center gap-1.5 px-1 pb-1 text-muted-foreground text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              Checking what you send
            </p>
          )}
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

          {/* Until the probe answers, one flat list — no grouping to rearrange. */}
          {(ungraded ? matching : ready).map((entry) => (
            <BuiltinRow key={entry.builtin.id} entry={entry} />
          ))}

          {!ungraded && needsData.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setNeedsDataOpen((open) => !open)}
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
              {showNeedsData &&
                needsData.map((entry) => (
                  <BuiltinRow key={entry.builtin.id} entry={entry} />
                ))}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function GroupLabel({ label, count }: { label: string; count: number }) {
  return (
    <header className="mb-1.5 px-1">
      <h2
        className="font-semibold text-[0.6875rem] text-foreground/75 uppercase tracking-wider"
        aria-label={`${label}, ${count}`}
      >
        <span aria-hidden>
          {label}
          <span className="ml-1.5 tabular-nums opacity-80">{count}</span>
        </span>
      </h2>
    </header>
  );
}

function BuiltinRow({ entry }: { entry: Graded }) {
  const { builtin, readiness } = entry;
  const Icon = CATEGORY_ICON[builtin.category];
  const reason =
    readiness?.status === "needs-setup" ? readiness.missing.join(", ") : null;

  return (
    <Link
      to="/dashboards/built-in/$slug"
      params={{ slug: builtin.id }}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
        "text-foreground hover:bg-muted/50",
      )}
      activeProps={{
        className: "bg-muted text-foreground [&>svg]:text-primary",
      }}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">{builtin.name}</span>
      {reason && (
        <span
          title={reason}
          className="max-w-32 shrink-0 truncate font-mono text-muted-foreground text-xs"
        >
          {reason}
        </span>
      )}
    </Link>
  );
}
