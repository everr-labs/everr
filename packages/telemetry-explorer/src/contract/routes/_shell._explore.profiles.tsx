import { createFileRoute } from "@tanstack/react-router";
import { ProfilesRoute } from "../../explore/pages";
import { profilesRoute } from "../../explore/routes";

export const Route = createFileRoute("/_shell/_explore/profiles")({
  ...profilesRoute,
  component: ProfilesRoute,
});
