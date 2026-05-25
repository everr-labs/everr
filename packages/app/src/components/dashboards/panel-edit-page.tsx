import { Button } from "@everr/ui/components/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@everr/ui/components/tabs";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import { dashboardOptions } from "@/data/dashboards/options";
import type { Panel } from "@/data/dashboards/types";
import { PanelPreview } from "./panel-preview";
import { QueryEditor } from "./query-editor";
import { VizOptions } from "./viz-options";

interface PanelEditPageProps {
  dashboardId: string;
  panelKey: string;
}

export function PanelEditPage({ dashboardId, panelKey }: PanelEditPageProps) {
  const navigate = useNavigate();
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

  if (!draft) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>Panel "{panelKey}" not found.</p>
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

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b p-4" style={{ minHeight: "240px" }}>
          <PanelPreview panel={draft} panelKey={panelKey} />
        </div>

        <Tabs defaultValue="query" className="min-h-0 flex-1 p-4">
          <TabsList variant="line">
            <TabsTrigger value="query">Query</TabsTrigger>
            <TabsTrigger value="visualization">Visualization</TabsTrigger>
          </TabsList>
          <TabsContent value="query" className="pt-4">
            <QueryEditor draft={draft} onChange={setDraft} />
          </TabsContent>
          <TabsContent value="visualization" className="pt-4">
            <VizOptions draft={draft} onChange={setDraft} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
