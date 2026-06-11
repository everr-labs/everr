import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { isNotFound, Link } from "@tanstack/react-router";
import { AlertCircle, ArrowUpRight } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { DashboardPanel } from "@/components/dashboards/dashboard-panel";
import { useDashboard } from "@/components/dashboards/use-dashboard";
import { dashboardOptions } from "@/data/dashboards/options";
import { type PanelEmbed, parsePanelEmbed } from "@/data/notebooks/embed";

const DEFAULT_HEIGHT = 350;

function EmbedFrame({
  height,
  children,
}: {
  height: number | undefined;
  children: ReactNode;
}) {
  return (
    <div
      className="not-prose my-4"
      style={{ height: height ?? DEFAULT_HEIGHT }}
    >
      {children}
    </div>
  );
}

function EmbedError({ message }: { message: string }) {
  return (
    <div className="not-prose my-4 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      <AlertCircle className="size-4 shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  );
}

/**
 * A ```panel fence: parse the YAML and render the matching embed form.
 */
export function PanelEmbedBlock({ source }: { source: string }) {
  const parsed = useMemo<
    PanelEmbed | { kind: "error"; message: string }
  >(() => {
    try {
      return parsePanelEmbed(source);
    } catch (e) {
      return {
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }, [source]);

  if (parsed.kind === "error") return <EmbedError message={parsed.message} />;
  if (parsed.kind === "inline") {
    return (
      <EmbedFrame height={parsed.height}>
        <DashboardPanel
          panel={parsed.panel}
          panelKey={parsed.panel.spec.display?.name ?? "panel"}
        />
      </EmbedFrame>
    );
  }
  if (parsed.kind === "ref") return <RefEmbed embed={parsed} />;
  return <DashboardEmbed embed={parsed} />;
}

function RefEmbed({ embed }: { embed: Extract<PanelEmbed, { kind: "ref" }> }) {
  // The notebook's shared panels travel through the dashboard context (see
  // toDashboardDocument), so ref lookup and query execution share one path.
  const panel = useDashboard().spec.panels[embed.ref];
  if (!panel) {
    return (
      <EmbedError
        message={`Panel "${embed.ref}" is not defined in this notebook's spec.panels`}
      />
    );
  }
  return (
    <EmbedFrame height={embed.height}>
      <DashboardPanel panel={panel} panelKey={embed.ref} />
    </EmbedFrame>
  );
}

function DashboardEmbed({
  embed,
}: {
  embed: Extract<PanelEmbed, { kind: "dashboard" }>;
}) {
  const { data, isPending, isError, error } = useQuery(
    dashboardOptions(embed.project, embed.slug),
  );

  if (isPending) {
    return (
      <EmbedFrame height={embed.height}>
        <Skeleton className="h-full w-full" />
      </EmbedFrame>
    );
  }
  if (isError || !data) {
    // getDashboard throws the framework's notFound() for a missing dashboard;
    // surface that as a plain "not found" instead of leaking the NotFound shape.
    const detail = isNotFound(error)
      ? ": not found"
      : error instanceof Error
        ? `: ${error.message}`
        : "";
    return (
      <EmbedError
        message={`Failed to load dashboard ${embed.project}/${embed.slug}${detail}`}
      />
    );
  }
  const panel = data.spec.panels[embed.panel];
  if (!panel) {
    return (
      <EmbedError
        message={`Dashboard ${embed.project}/${embed.slug} has no panel "${embed.panel}"`}
      />
    );
  }
  return (
    <EmbedFrame height={embed.height}>
      <DashboardPanel
        panel={panel}
        panelKey={embed.panel}
        action={
          <Link
            to="/dashboards/$project/$slug"
            params={{ project: embed.project, slug: embed.slug }}
            aria-label={`Open panel in dashboard ${embed.project}/${embed.slug}`}
            title={`Open in ${data.spec.display?.name ?? embed.slug}`}
            className="rounded-md p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowUpRight className="size-4" />
          </Link>
        }
      />
    </EmbedFrame>
  );
}
