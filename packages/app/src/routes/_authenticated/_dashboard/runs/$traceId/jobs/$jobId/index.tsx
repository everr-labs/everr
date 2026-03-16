import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { runDetailsOptions } from "@/data/runs/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/runs/$traceId/jobs/$jobId/",
)({
  component: JobDetailPage,
});

function JobDetailPage() {
  const { traceId } = Route.useParams();
  const { data: runDetails } = useQuery(runDetailsOptions(traceId));

  if (!runDetails) {
    return null;
  }

  return (
    <Card size="sm" className="h-full">
      <CardContent className="flex h-full items-center justify-center">
        <p className="text-muted-foreground text-sm">
          Select a step to view logs
        </p>
      </CardContent>
    </Card>
  );
}
