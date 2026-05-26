import { Button } from "@everr/ui/components/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@everr/ui/components/resizable";
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import { dashboardOptions, panelQueryOptions } from "@/data/dashboards/options";
import { runPanelQuery } from "@/data/dashboards/server";
import type { Panel } from "@/data/dashboards/types";
import { PanelPreview } from "./panel-preview";
import { QueryEditor } from "./query-editor";
import type { QueryResultRow } from "./visualizations";
import { VizOptions } from "./viz-options";

interface PanelEditPageProps {
  dashboardId: string;
  panelKey: string;
}

function getQuerySql(panel: Panel): string {
  const query = panel.spec.queries?.[0];
  if (!query) return "";
  const spec = query.spec.plugin.spec;
  return typeof spec.query === "string" ? spec.query : "";
}

export function PanelEditPage({ dashboardId, panelKey }: PanelEditPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const storeDashboard = useDashboardStore((s) => s.dashboard);
  const setDashboard = useDashboardStore((s) => s.setDashboard);
  const updatePanel = useDashboardStore((s) => s.updatePanel);

  const { data: fetchedDashboard } = useSuspenseQuery(
    dashboardOptions(dashboardId),
  );

  useEffect(() => {
    if (!storeDashboard) {
      setDashboard(fetchedDashboard);
    }
  }, [storeDashboard, fetchedDashboard, setDashboard]);

  const dashboard = storeDashboard ?? fetchedDashboard;
  const panel = dashboard.spec.panels[panelKey];

  const [draft, setDraft] = useState<Panel | null>(panel ?? null);

  useEffect(() => {
    if (panel && !draft) {
      setDraft(panel);
    }
  }, [panel, draft]);

  const savedSql = panel ? getQuerySql(panel) : "";
  const { data: autoResult } = useQuery(panelQueryOptions(savedSql));

  const [manualResult, setManualResult] = useState<
    QueryResultRow[] | undefined
  >();
  const [isRunning, setIsRunning] = useState(false);

  const handleRunQuery = useCallback(
    async (sql: string) => {
      setIsRunning(true);
      try {
        const result = await runPanelQuery({ data: { sql } });
        setManualResult(result.rows);
        queryClient.setQueryData(panelQueryOptions(sql).queryKey, result);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Query failed");
      } finally {
        setIsRunning(false);
      }
    },
    [queryClient],
  );

  const queryResult = manualResult ?? autoResult?.rows;

  if (!draft) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>Panel &ldquo;{panelKey}&rdquo; not found.</p>
      </div>
    );
  }

  const handleApply = () => {
    updatePanel(panelKey, draft);
    navigate({
      to: "/dashboards/$dashboardId",
      params: { dashboardId },
    });
  };

  const handleDiscard = () => {
    navigate({
      to: "/dashboards/$dashboardId",
      params: { dashboardId },
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Link
            to="/dashboards/$dashboardId"
            params={{ dashboardId }}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="text-sm font-semibold">
            {draft.spec.display.name ?? panelKey}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleDiscard}>
            Discard
          </Button>
          <Button size="sm" onClick={handleApply}>
            Apply
          </Button>
        </div>
      </div>

      <ResizablePanelGroup className="min-h-0 flex-1">
        <ResizablePanel defaultSize={65} minSize={30}>
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel defaultSize={50} minSize={20}>
              <div className="h-full overflow-auto p-4">
                <PanelPreview
                  panel={draft}
                  panelKey={panelKey}
                  data={queryResult}
                />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={20}>
              <div className="h-full overflow-auto p-4">
                <QueryEditor
                  draft={draft}
                  onChange={setDraft}
                  onRunQuery={handleRunQuery}
                  isRunning={isRunning}
                />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={35} minSize={20}>
          <div className="h-full overflow-auto p-4">
            <VizOptions draft={draft} onChange={setDraft} />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
