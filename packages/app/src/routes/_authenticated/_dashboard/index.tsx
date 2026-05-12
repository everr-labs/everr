import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { SiGithub } from "@icons-pack/react-simple-icons";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  ChartLine,
  Check,
  ChevronRight,
  Copy,
  Download,
  FileText,
  FlaskConical,
  GitBranch,
  Terminal,
} from "lucide-react";
import { type ComponentType, type ReactNode, useState } from "react";
import {
  DESKTOP_DOWNLOAD_URL,
  INSTALL_COMMAND,
} from "@/common/install-command";
import { cliEverApprovedOptions } from "@/data/home";

export const Route = createFileRoute("/_authenticated/_dashboard/")({
  staticData: { breadcrumb: "Home", hideTimeRangePicker: true },
  head: () => ({
    meta: [{ title: "Everr - Home" }],
  }),
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData(cliEverApprovedOptions());
  },
  component: HomePage,
});

function HomePage() {
  const { data } = useQuery(cliEverApprovedOptions());
  const cliEverApproved = data?.cliEverApproved ?? false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Home</h1>
        <p className="text-muted-foreground text-sm">
          Pick up where you left off.
        </p>
      </div>

      {!cliEverApproved && <InstallEverrCard />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SectionCard
          title="Runs"
          description="Browse every workflow run"
          icon={Activity}
        >
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
            className="absolute inset-0"
            aria-label="Go to Runs"
          />
        </SectionCard>
        <SectionCard
          title="Workflows"
          description="Drill into workflows by repo"
          icon={GitBranch}
        >
          <Link
            to="/workflows"
            className="absolute inset-0"
            aria-label="Go to Workflows"
          />
        </SectionCard>
        <SectionCard
          title="Repositories"
          description="Health and stats per repository"
          icon={SiGithub}
        >
          <Link
            to="/repos"
            className="absolute inset-0"
            aria-label="Go to Repositories"
          />
        </SectionCard>
        <SectionCard
          title="Logs"
          description="Search logs across runs"
          icon={FileText}
        >
          <Link
            to="/logs"
            className="absolute inset-0"
            aria-label="Go to Logs"
          />
        </SectionCard>
        <SectionCard
          title="Tests"
          description="Spot flaky and slow tests"
          icon={FlaskConical}
        >
          <Link
            to="/tests-overview"
            className="absolute inset-0"
            aria-label="Go to Tests"
          />
        </SectionCard>
        <SectionCard
          title="Cost analysis"
          description="See where CI minutes go"
          icon={ChartLine}
        >
          <Link
            to="/cost-analysis"
            className="absolute inset-0"
            aria-label="Go to Cost Analysis"
          />
        </SectionCard>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <Card className="group relative h-full transition-colors hover:bg-muted/30">
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
      {children}
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
        <DesktopOption />
        <CliOption />
      </CardContent>
    </Card>
  );
}

function DesktopOption() {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-4">
      <div className="flex items-center gap-2">
        <Download className="size-4 text-primary" />
        <span className="text-sm font-medium">Desktop app</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Native menu-bar app for macOS (Apple Silicon).
      </p>
      <Button
        size="sm"
        className="self-start"
        nativeButton={false}
        // biome-ignore lint/a11y/useAnchorContent: content is supplied by Button's children via base-ui render prop
        render={<a href={DESKTOP_DOWNLOAD_URL} />}
      >
        Download .dmg
      </Button>
    </div>
  );
}

function CliOption() {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(INSTALL_COMMAND).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-4">
      <div className="flex items-center gap-2">
        <Terminal className="size-4 text-primary" />
        <span className="text-sm font-medium">CLI</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Cross-platform. Run in your terminal:
      </p>
      <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 font-mono">
        <code className="flex-1 truncate text-xs">{INSTALL_COMMAND}</code>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Copy install command"
        >
          {copied ? (
            <Check className="size-4 text-green-500" />
          ) : (
            <Copy className="size-4" />
          )}
        </button>
      </div>
    </div>
  );
}
