import { createFileRoute } from "@tanstack/react-router";
import { DeveloperPage } from "../features/developer/developer-page";

export const Route = createFileRoute("/_shell/developer")({
  staticData: { breadcrumb: "Developer" },
  head: () => ({ meta: [{ title: "Everr - Developer" }] }),
  component: DeveloperPage,
});
