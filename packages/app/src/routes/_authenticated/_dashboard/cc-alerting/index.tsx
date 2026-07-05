import { createFileRoute, redirect } from "@tanstack/react-router";

// `/cc-alerting` has no page of its own — send it to the section landing.
export const Route = createFileRoute("/_authenticated/_dashboard/cc-alerting/")(
  {
    beforeLoad: () => {
      throw redirect({ to: "/cc-alerting/overview" });
    },
  },
);
