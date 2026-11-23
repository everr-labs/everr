import { createFileRoute } from "@tanstack/react-router";
import { ErrorsRoute } from "../../explore/pages";
import { errorsRoute } from "../../explore/routes";

export const Route = createFileRoute("/_shell/_explore/errors")({
  ...errorsRoute,
  component: ErrorsRoute,
});
