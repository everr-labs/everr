import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";

const parentRoute = getRouteApi("/dashboard/runs/$traceId");

export const Route = createFileRoute("/dashboard/runs/$traceId/")({
  component: RunDetailPage,
});

function RunDetailPage() {
  const { runDetails } = parentRoute.useLoaderData();

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
