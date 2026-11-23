import { ErrorPageRoute } from "@everr/telemetry-explorer/explore/pages";
import { errorDetailRoute } from "@everr/telemetry-explorer/explore/routes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_shell/_explore/errors_/$fingerprint")({
  ...errorDetailRoute,
  component: ErrorPageRoute,
});
