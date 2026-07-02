import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  ChartLine,
  ChevronRight,
  Download,
  FileText,
  FlaskConical,
} from "lucide-react";
import type { ComponentType } from "react";
import { INSTALL_COMMAND } from "@/common/install-command";
import { InstallCommandBlock } from "@/components/install-command-block";

export const Route = createFileRoute("/_authenticated/_dashboard/_padded/")({
  staticData: { breadcrumb: "Home", hideTimeRangePicker: true },
  head: () => ({
    meta: [{ title: "Everr - Home" }],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Home</h1>
        <p className="text-muted-foreground text-sm">
          Pick up where you left off.
        </p>
      </div>

      <InstallEverrCard />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          to="/runs"
          search={{
            repos: [],
            branches: [],
            conclusions: [],
            workflowNames: [],
            runId: undefined,
          }}
          className="block h-full"
        >
          <SectionCard
            title="Runs"
            description="Browse every workflow run"
            icon={Activity}
          />
        </Link>
        <Link to="/logs" className="block h-full">
          <SectionCard
            title="Logs"
            description="Search logs across runs"
            icon={FileText}
          />
        </Link>
        <Link to="/tests-overview" className="block h-full">
          <SectionCard
            title="Tests"
            description="Spot flaky and slow tests"
            icon={FlaskConical}
          />
        </Link>
        <Link to="/cost-analysis" className="block h-full">
          <SectionCard
            title="Cost analysis"
            description="See where CI minutes go"
            icon={ChartLine}
          />
        </Link>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="group h-full transition-colors hover:bg-muted/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-primary" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto flex items-center justify-end pt-2">
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </CardContent>
    </Card>
  );
}

function InstallEverrCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Download className="size-4 text-primary" />
          Install Everr
        </CardTitle>
        <CardDescription>
          Get notified when CI fails, run queries from your terminal, and
          integrate with your coding assistant.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <InstallCommandBlock command={INSTALL_COMMAND} />
      </CardContent>
    </Card>
  );
}
