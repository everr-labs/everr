import { createFileRoute } from "@tanstack/react-router";
import { TracesError, TracesRoute } from "../../explore/pages";
import { tracesRoute } from "../../explore/routes";

export const Route = createFileRoute("/_shell/_explore/traces")({
  ...tracesRoute,
  component: TracesRoute,
  errorComponent: TracesError,
});
