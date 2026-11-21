import { createFileRoute } from "@tanstack/react-router";
import { ErrorModalRoute } from "../../explore/pages";
import { errorDetailRoute } from "../../explore/routes";

export const Route = createFileRoute("/_shell/_explore/errors/$fingerprint/modal")({
  ...errorDetailRoute,
  component: ErrorModalRoute,
});
