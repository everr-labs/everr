import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  Boxes,
  Cpu,
  Database,
  Globe,
  Loader2,
  RotateCw,
  SearchIcon,
  TriangleAlert,
} from "lucide-react";
import {
  type KeyboardEvent,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  dashboardListOptions,
  dashboardsQueryKey,
  telemetryCapabilitiesOptions,
} from "@/data/dashboards/options";
import { createDashboardFromTemplate } from "@/data/dashboards/server";
import {
  evaluateTemplate,
  type TemplateReadiness,
} from "@/data/dashboards/templates/capabilities";
import { DASHBOARD_TEMPLATES } from "@/data/dashboards/templates/catalog";
import type {
  DashboardTemplate,
  TemplateCategory,
} from "@/data/dashboards/templates/types";
import { TEMPLATE_CATEGORIES } from "@/data/dashboards/templates/types";
import { useTimeRange } from "@/hooks/use-time-range";
import { DashboardGrid } from "./dashboard-grid";
import { DashboardProvider } from "./use-dashboard";

const CATEGORY_ICON: Record<
  TemplateCategory,
  React.ComponentType<{ className?: string }>
> = {
  Application: Activity,
  Runtime: Cpu,
  Databases: Database,
  Infrastructure: Boxes,
  Browser: Globe,
};

/**
 * A template plus what the probe can say about it. `readiness` is null until the
 * probe answers: grading against an empty result would label every template
 * unready for a reason nothing has established, and the page would then paint a
 * grouping it is about to rearrange under the reader's cursor. Null says "not
 * known yet" once, rather than every reader of a grade having to check whether
 * the grade means anything.
 */
interface Graded {
  template: DashboardTemplate;
  readiness: TemplateReadiness | null;
}

export function TemplateGallery({
  selectedId,
  onSelect,
}: {
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const { timeRange } = useTimeRange();

  // The same range the previews below render. Readiness is a claim about that
  // exact window, so the two can never contradict each other on screen.
  const capabilitiesQuery = useQuery(
    telemetryCapabilitiesOptions(timeRange.from, timeRange.to),
  );
  const capabilities = capabilitiesQuery.data;
  const graded = useMemo<Graded[]>(
    () =>
      DASHBOARD_TEMPLATES.map((template) => ({
        template,
        readiness: capabilities
          ? evaluateTemplate(template, capabilities)
          : null,
      })),
    [capabilities],
  );

  // Hoisted out of the preview, which remounts on every selection: the set of
  // Dashboards is the same whichever template is showing.
  const { data: dashboards } = useQuery(dashboardListOptions());

  const matching = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return graded;
    return graded.filter(
      ({ template }) =>
        template.name.toLowerCase().includes(q) ||
        template.description.toLowerCase().includes(q) ||
        template.category.toLowerCase().includes(q) ||
        // Requirements are searchable too: someone who knows they emit `redis.*`
        // should find the Redis template by typing what they send, not only by
        // guessing its title.
        template.requires.some((r) => r.match.toLowerCase().includes(q)),
    );
  }, [graded, search]);

  const selected =
    matching.find((g) => g.template.id === selectedId) ??
    graded.find((g) => g.template.id === selectedId) ??
    matching[0];

  /*
   * The list highlights immediately; the preview lags one commit behind.
   * Mounting a preview runs a grid of ClickHouse queries, and an abandoned
   * concurrent render never commits, so its effects never run and no query is
   * issued for a template the reader only passed over. Holding an arrow key down
   * mounts one grid rather than nineteen.
   */
  const previewed = useDeferredValue(selected);

  return (
    <div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:-mt-1">
          <div className="relative">
            <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
              aria-label="Search templates"
            />
          </div>

          {/*
            The probe's non-success states live here rather than in a page
            header: they describe the list, and this is the only place left that
            can say so once the section headings carry the counts.
          */}
          {capabilitiesQuery.isPending && (
            <p className="inline-flex items-center gap-1.5 px-1 text-muted-foreground text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              Checking what you send in this time range
            </p>
          )}
          {capabilitiesQuery.isError && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs">
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

          <TemplateList
            entries={matching}
            selectedId={selected?.template.id}
            onSelect={onSelect}
          />
        </aside>

        {previewed ? (
          <TemplatePreview
            key={previewed.template.id}
            template={previewed.template}
            readiness={previewed.readiness}
            alreadyCreated={dashboards?.find(
              (d) => d.uiOwned && d.template === previewed.template.id,
            )}
          />
        ) : (
          <p className="py-24 text-center text-muted-foreground text-sm">
            No template matches that search. Clear it to see all{" "}
            {DASHBOARD_TEMPLATES.length}.
          </p>
        )}
      </div>
    </div>
  );
}

interface Group {
  category: TemplateCategory | null;
  items: Graded[];
}

interface ListSection {
  key: string;
  label: string | null;
  count: number;
  note: string | null;
  groups: Group[];
}

function TemplateList({
  entries,
  selectedId,
  onSelect,
}: {
  entries: Graded[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const sections = useMemo<ListSection[]>(() => {
    if (entries.some((e) => e.readiness === null)) {
      return [
        {
          key: "all",
          label: null,
          count: entries.length,
          note: null,
          groups: [{ category: null, items: entries }],
        },
      ];
    }
    const byCategory = (group: Graded[]): Group[] =>
      TEMPLATE_CATEGORIES.map((category) => ({
        category: category as TemplateCategory | null,
        items: group.filter((e) => e.template.category === category),
      })).filter((g) => g.items.length > 0);

    const ready = entries.filter((e) => e.readiness?.status === "ready");
    const rest = entries.filter((e) => e.readiness?.status !== "ready");
    const sections: ListSection[] = [];
    if (ready.length > 0) {
      sections.push({
        key: "ready",
        label: "Ready for your data",
        count: ready.length,
        note: null,
        groups: byCategory(ready),
      });
    }
    if (rest.length > 0) {
      sections.push({
        key: "not-ready",
        label: "Not ready in this range",
        count: rest.length,
        // Said once for the whole group rather than repeated per category.
        note: "these would render empty",
        groups: byCategory(rest),
      });
    }
    return sections;
  }, [entries]);

  // Roving tabindex over the flat order: one tab stop for the whole list, then
  // arrows move within it. Without this the reader tabs through every template
  // to reach anything past it.
  const order = entries.map((e) => e.template.id);
  const activeIndex = Math.max(0, selectedId ? order.indexOf(selectedId) : 0);

  const moveTo = (index: number) => {
    const id = order[index];
    if (!id) return;
    onSelect(id);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-template-id="${CSS.escape(id)}"]`)
      ?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next: Record<string, number | undefined> = {
      ArrowDown: Math.min(activeIndex + 1, order.length - 1),
      ArrowUp: Math.max(activeIndex - 1, 0),
      Home: 0,
      End: order.length - 1,
    };
    const target = next[event.key];
    if (target === undefined) return;
    event.preventDefault();
    moveTo(target);
  };

  if (entries.length === 0) {
    return (
      <p className="px-1 py-6 text-muted-foreground text-sm">
        Nothing matches. Clear the search to see every template.
      </p>
    );
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Dashboard templates"
      onKeyDown={onKeyDown}
      className="flex flex-col gap-5"
    >
      {sections.map((section) => (
        <section key={section.key} aria-label={section.label ?? undefined}>
          {section.label && (
            <header className="mb-1.5 flex items-baseline justify-between gap-3 px-1">
              <h2
                className="font-semibold text-[0.6875rem] text-foreground/75 uppercase tracking-wider"
                // One phrase, so a screen reader never says
                // "ready for your data twelve".
                aria-label={`${section.label}, ${section.count} templates`}
              >
                <span aria-hidden>
                  {section.label}
                  <span className="ml-1.5 tabular-nums opacity-80">
                    {section.count}
                  </span>
                </span>
              </h2>
              {section.note && (
                <span className="truncate text-[0.6875rem] text-muted-foreground">
                  {section.note}
                </span>
              )}
            </header>
          )}
          {section.groups.map((group) => (
            <div key={group.category ?? "all"}>
              {group.category && (
                <h3 className="mt-2.5 mb-0.5 px-2 font-medium text-[0.6875rem] text-muted-foreground/80 first:mt-0">
                  {group.category}
                </h3>
              )}
              {group.items.map((entry) => (
                <TemplateRow
                  key={entry.template.id}
                  template={entry.template}
                  readiness={entry.readiness}
                  selected={entry.template.id === selectedId}
                  tabbable={entry.template.id === order[activeIndex]}
                  onSelect={() => onSelect(entry.template.id)}
                />
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function TemplateRow({
  template,
  readiness,
  selected,
  tabbable,
  onSelect,
}: {
  template: DashboardTemplate;
  readiness: TemplateReadiness | null;
  selected: boolean;
  tabbable: boolean;
  onSelect: () => void;
}) {
  const Icon = CATEGORY_ICON[template.category];
  const reason =
    readiness?.status === "needs-setup" ? readiness.missing.join(", ") : null;

  return (
    <div
      data-template-id={template.id}
      role="option"
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onSelect();
      }}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
        "focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-0",
        selected
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      <Icon
        className={cn(
          "size-3.5 shrink-0",
          selected ? "text-primary" : "text-muted-foreground",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-sm">{template.name}</span>
      {reason && (
        <span
          title={reason}
          className="max-w-36 shrink-0 truncate font-mono text-muted-foreground text-xs"
        >
          {reason}
        </span>
      )}
    </div>
  );
}

function TemplatePreview({
  template,
  readiness,
  alreadyCreated,
}: {
  template: DashboardTemplate;
  readiness: TemplateReadiness | null;
  /** The Dashboard this template already made, while the app still owns it. */
  alreadyCreated?: { project: string; slug: string };
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const Icon = CATEGORY_ICON[template.category];

  const create = useMutation({
    mutationFn: () =>
      createDashboardFromTemplate({ data: { templateId: template.id } }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: dashboardsQueryKey });
      toast.success(`Created ${template.name}`, {
        description: `${created.project} / ${created.slug}`,
      });
      void navigate({
        to: "/dashboards/$project/$slug",
        params: { project: created.project, slug: created.slug },
      });
    },
    onError: (error) =>
      toast.error("Couldn't create the dashboard", {
        description: error instanceof Error ? error.message : undefined,
      }),
  });

  return (
    <section className="flex min-w-0 flex-col gap-5">
      {/* Announces the swap for readers who cannot see the pane change. */}
      <p aria-live="polite" className="sr-only">
        Previewing {template.name}
      </p>

      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/60">
            <Icon className="size-4 text-primary" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold text-xl tracking-tight">
              {template.name}
            </h2>
            <p className="mt-0.5 text-muted-foreground text-xs">
              {template.category}
            </p>
            <p className="mt-2 max-w-prose text-foreground/80 text-sm/relaxed">
              {template.description}
            </p>
            {readiness?.status === "needs-setup" && (
              <p role="status" className="mt-2 text-muted-foreground text-xs">
                Nothing to draw yet: this needs{" "}
                <span className="font-mono text-foreground/90">
                  {readiness.missing.join(", ")}
                </span>{" "}
                in the selected time range. You can still create it and send the
                data later.
              </p>
            )}
          </div>
        </div>

        {/*
          The commit sits with the thing it names rather than in a bar under the
          preview: the reader decides from the title and description, and the
          destination has to be legible at the moment of deciding, not after
          scrolling a grid of panels.
        */}
        {/*
          Creating a second identical copy is almost never what the reader
          wants, so once this template has one the action becomes the way back
          to it rather than a second create.
        */}
        <div className="shrink-0">
          <Button
            type="button"
            disabled={create.isPending}
            onClick={() =>
              alreadyCreated
                ? void navigate({
                    to: "/dashboards/$project/$slug",
                    params: alreadyCreated,
                  })
                : create.mutate()
            }
          >
            {create.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ArrowRight className="size-3.5" />
            )}
            {alreadyCreated ? "Open dashboard" : "Create dashboard"}
          </Button>
        </div>
      </header>

      {/*
        The real renderer on the real document — the same DashboardProvider and
        grid the dashboard route uses, against an unpersisted spec. Nothing is
        stored until Create is pressed.
      */}
      <section
        className="min-w-0"
        aria-label={`Preview of ${template.name} with your data`}
      >
        <DashboardProvider document={template.document}>
          <DashboardGrid />
        </DashboardProvider>
      </section>
    </section>
  );
}
