import { createFileRoute } from "@tanstack/react-router";
import { ErrorPageRoute } from "../../explore/pages";
import { errorDetailRoute } from "../../explore/routes";

export const Route = createFileRoute("/_shell/_explore/errors/$fingerprint")({
  ...errorDetailRoute,
  component: ErrorPageRoute,
});
