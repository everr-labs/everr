import { createFileRoute } from "@tanstack/react-router";
import { Activity, CheckCircle, Percent, XCircle } from "lucide-react";
import { LatestRunsCard } from "@/components/dashboard/latest-runs-card";
import { RepoListCard } from "@/components/dashboard/repo-list-card";
import { StatCard, StatCardSkeleton } from "@/components/dashboard/stat-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getDashboardStats,
  getRecentActivity,
  getRepositories,
} from "@/data/dashboard-stats";
import { getLatestRuns } from "@/data/runs";

export const Route = createFileRoute("/dashboard/")({
  component: DashboardPage,
  loader: async () => {
    const [stats, repositories, recentActivity, latestRuns] = await Promise.all(
      [
        getDashboardStats(),
        getRepositories(),
        getRecentActivity(),
        getLatestRuns(),
      ],
    );
    return { stats, repositories, recentActivity, latestRuns };
  },
  pendingComponent: DashboardSkeleton,
  errorComponent: DashboardError,
});

function DashboardPage() {
  const { stats, repositories, recentActivity, latestRuns } =
    Route.useLoaderData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview of your CI/CD pipelines
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Job Runs"
          description="All time"
          value={stats.totalJobRuns}
          icon={Activity}
        />
        <StatCard
          title="Successful Runs"
          description="Completed successfully"
          value={stats.successfulRuns}
          icon={CheckCircle}
        />
        <StatCard
          title="Failed Runs"
          description="Completed with errors"
          value={stats.failedRuns}
          icon={XCircle}
        />
        <StatCard
          title="Success Rate"
          description="Overall pass rate"
          value={`${stats.successRate}%`}
          icon={Percent}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <RepoListCard repositories={repositories} />

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            {recentActivity.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No recent activity
              </p>
            ) : (
              <div className="space-y-2">
                {recentActivity.map((day) => (
                  <div
                    key={day.date}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-muted-foreground">
                      {new Date(day.date).toLocaleDateString()}
                    </span>
                    <div className="flex gap-3">
                      <span className="text-green-600">
                        {day.successCount} passed
                      </span>
                      <span className="text-red-600">
                        {day.failureCount} failed
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <LatestRunsCard runs={latestRuns} />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-1 h-4 w-48" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton items
          <StatCardSkeleton key={i} />
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton items
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </CardHeader>
          <CardContent className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton items
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DashboardError({ error }: { error: Error }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview of your CI/CD pipelines
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <p className="text-destructive font-medium">
              Failed to load dashboard data
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {error.message}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
