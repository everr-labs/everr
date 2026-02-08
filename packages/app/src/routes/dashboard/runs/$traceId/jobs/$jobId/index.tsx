import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";

const parentRoute = getRouteApi("/dashboard/runs/$traceId");

export const Route = createFileRoute("/dashboard/runs/$traceId/jobs/$jobId/")({
  component: JobDetailPage,
});

function JobDetailPage() {
  const { runDetails } = parentRoute.useLoaderData();

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
