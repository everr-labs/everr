import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Repository } from "@/data/dashboard-stats";
import { getSuccessRateVariant } from "@/lib/formatting";

interface RepoListCardProps {
  repositories: Repository[];
  isLoading?: boolean;
}

export function RepoListCard({ repositories, isLoading }: RepoListCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton items
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Watched Repositories</CardTitle>
        <CardDescription>Repositories sending CI/CD telemetry</CardDescription>
      </CardHeader>
      <CardContent>
        {repositories.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No repositories found. Set up a webhook to start collecting data.
          </p>
        ) : (
          <div className="space-y-3">
            {repositories.map((repo) => (
              <div
                key={repo.name}
                className="flex items-center justify-between"
              >
                <div className="flex flex-col">
                  <Link
                    to="/dashboard/repos"
                    search={{ name: repo.name, timeRange: "7d" }}
                    className="text-sm font-medium hover:underline"
                  >
                    {repo.name}
                  </Link>
                  <span className="text-muted-foreground text-xs">
                    {repo.totalRuns} runs
                  </span>
                </div>
                <Badge variant={getSuccessRateVariant(repo.successRate)}>
                  {repo.successRate}%
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
