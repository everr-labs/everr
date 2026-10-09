import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../features/app-shell/settings-page";
export const Route = createFileRoute("/_shell/settings")({
  component: SettingsPage,
});
