import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { runDetailsOptions } from "@/data/runs/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/runs/$traceId/",
)({
  component: RunDetailPage,
});

function RunDetailPage() {
  const { traceId } = Route.useParams();
  const { data: runDetails } = useQuery(runDetailsOptions(traceId));

  if (!runDetails) {
    return null;
  }

  return (
    <Card size="sm">
      <CardContent className="flex h-[calc(100vh-200px)] items-center justify-center">
        <p className="text-muted-foreground text-sm">
          Select a step to view logs
        </p>
      </CardContent>
    </Card>
  );
}
