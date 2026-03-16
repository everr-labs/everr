import { Badge } from "@/components/ui/badge";
import type { RepoStats } from "@/data/repo-detail/schemas";
import { formatDuration, getSuccessRateVariant } from "@/lib/formatting";

interface RepoHeaderProps {
  name: string;
  stats: RepoStats;
}

export function RepoHeader({ name, stats }: RepoHeaderProps) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
      <div className="mt-2 flex items-center gap-3">
        <Badge variant="outline">{stats.totalRuns} runs</Badge>
        <Badge variant={getSuccessRateVariant(stats.successRate)}>
          {stats.successRate}% success
        </Badge>
        <Badge variant="outline">
          avg {formatDuration(stats.avgDuration, "ms")}
        </Badge>
      </div>
    </div>
  );
}
