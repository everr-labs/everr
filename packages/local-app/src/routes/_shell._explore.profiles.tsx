import { ProfilesRoute } from "@everr/telemetry-explorer/explore/pages";
import { profilesRoute } from "@everr/telemetry-explorer/explore/routes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_shell/_explore/profiles")({
  ...profilesRoute,
  component: ProfilesRoute,
});
