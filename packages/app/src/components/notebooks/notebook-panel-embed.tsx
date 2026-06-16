import { AlertCircle } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { DashboardPanel } from "@/components/dashboards/dashboard-panel";
import { useDashboard } from "@/components/dashboards/use-dashboard";
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
  return <RefEmbed embed={parsed} />;
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
