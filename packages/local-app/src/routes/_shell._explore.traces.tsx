import { TracesRoute } from "@everr/app-shell/explore/pages";
import { tracesRoute } from "@everr/app-shell/explore/routes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_shell/_explore/traces")({
  ...tracesRoute,
  component: TracesRoute,
});
