import { createFileRoute } from "@tanstack/react-router";
import { DeveloperPage } from "../features/developer/developer-page";
export const Route = createFileRoute("/_shell/developer")({
  component: DeveloperPage,
});
