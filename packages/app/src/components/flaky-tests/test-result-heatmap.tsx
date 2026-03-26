import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import type { TestDailyResult } from "@/data/flaky-tests/schemas";

interface TestResultHeatmapProps {
  data: TestDailyResult[];
}

function getCellColor(day: TestDailyResult): string {
  const total = day.passCount + day.failCount;
  if (total === 0) return "bg-muted";
  if (day.failCount === 0) return "bg-green-500";
  if (day.passCount === 0) return "bg-red-500";
  const failRatio = day.failCount / total;
  if (failRatio > 0.5) return "bg-red-400";
  if (failRatio > 0.2) return "bg-orange-400";
  return "bg-yellow-400";
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function TestResultHeatmap({ data }: TestResultHeatmapProps) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No test results in this time range.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-0.5">
        <TooltipProvider delay={100}>
          {data.map((day) => (
            <Tooltip key={day.date}>
              <TooltipTrigger>
                <div className={`h-4 w-4 rounded-sm ${getCellColor(day)}`} />
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-medium">{formatDate(day.date)}</p>
                <p className="text-xs">
                  {day.passCount} pass / {day.failCount} fail
                  {day.skipCount > 0 && ` / ${day.skipCount} skip`}
                </p>
              </TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="h-3 w-3 rounded-sm bg-green-500" />
          <span>All pass</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-3 w-3 rounded-sm bg-yellow-400" />
          <span>Mixed</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-3 w-3 rounded-sm bg-red-500" />
          <span>All fail</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-3 w-3 rounded-sm bg-muted" />
          <span>No data</span>
        </div>
      </div>
    </div>
  );
}
