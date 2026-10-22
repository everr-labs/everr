import { Link } from "@tanstack/react-router";

function checkCloudNavigationTypes() {
  return (
    <>
      <Link to="/billing" />
      {/* @ts-expect-error The Cloud route tree does not include the self-hosted setup route. */}
      <Link to="/setup" />
    </>
  );
}

void checkCloudNavigationTypes;
