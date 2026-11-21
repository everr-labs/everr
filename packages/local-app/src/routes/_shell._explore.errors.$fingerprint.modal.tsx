import { ErrorModalRoute } from "@everr/app-shell/explore/pages";
import { errorDetailRoute } from "@everr/app-shell/explore/routes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_shell/_explore/errors/$fingerprint/modal")({
  ...errorDetailRoute,
  component: ErrorModalRoute,
});
