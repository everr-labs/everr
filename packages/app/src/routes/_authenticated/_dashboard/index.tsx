import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { SiGithub } from "@icons-pack/react-simple-icons";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  ChartLine,
  ChevronRight,
  Download,
  FileText,
  FlaskConical,
  GitBranch,
  Terminal,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import {
  DESKTOP_DOWNLOAD_URL,
  INSTALL_COMMAND,
} from "@/common/install-command";
import { InstallCommandBlock } from "@/components/install-command-block";

export const Route = createFileRoute("/_authenticated/_dashboard/")({
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
            page: 1,
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
        <Link to="/workflows" className="block h-full">
          <SectionCard
            title="Workflows"
            description="Drill into workflows by repo"
            icon={GitBranch}
          />
        </Link>
        <Link to="/repos" className="block h-full">
          <SectionCard
            title="Repositories"
            description="Health and stats per repository"
            icon={SiGithub}
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
        <CardTitle className="text-base">Install Everr</CardTitle>
        <CardDescription>
          Get notified when CI fails, run queries from your terminal, and
          integrate with your editor.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        <InstallOption
          icon={Download}
          title="Desktop app"
          description="Native menu-bar app for macOS (Apple Silicon)."
        >
          <Button
            size="sm"
            className="self-start"
            nativeButton={false}
            // biome-ignore lint/a11y/useAnchorContent: content is supplied by Button's children via base-ui render prop
            render={<a href={DESKTOP_DOWNLOAD_URL} />}
          >
            Download .dmg
          </Button>
        </InstallOption>
        <InstallOption
          icon={Terminal}
          title="CLI"
          description="Cross-platform. Run in your terminal:"
        >
          <InstallCommandBlock command={INSTALL_COMMAND} />
        </InstallOption>
      </CardContent>
    </Card>
  );
}

function InstallOption({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-4">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-primary" />
        <span className="text-sm font-medium">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      {children}
    </div>
  );
}
