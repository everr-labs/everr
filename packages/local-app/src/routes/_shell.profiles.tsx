import { createFileRoute } from "@tanstack/react-router";
import { ProfilesPage, ProfilesSearchSchema } from "../features/profiles/profiles-page";
export const Route = createFileRoute("/_shell/profiles")({
  validateSearch: ProfilesSearchSchema,
  component: ProfilesPage,
});
