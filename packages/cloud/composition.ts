import { resolve } from "node:path";
import type { AppComposition } from "@everr/app/build/composition";

const routeFile = (file: string) =>
  resolve(import.meta.dirname, "src/routes", file);

export const cloudComposition: AppComposition = {
  directory: import.meta.dirname,
  cssSources: [resolve(import.meta.dirname, "./src")],
  migrationHistories: {
    cloud: resolve(import.meta.dirname, "src/drizzle"),
    legacy: resolve(import.meta.dirname, "src/drizzle-legacy"),
  },
  routes: {
    signedIn: [
      {
        type: "route",
        path: "create-organization",
        file: routeFile("_welcome/_signedIn/create-organization.tsx"),
      },
      {
        type: "route",
        path: "choose-organization",
        file: routeFile("_welcome/_signedIn/choose-organization.tsx"),
      },
      {
        type: "route",
        path: "organizations/checkout/success",
        file: routeFile(
          "_welcome/_signedIn/organizations.checkout.success.tsx",
        ),
      },
      {
        type: "layout",
        id: "_organization",
        file: routeFile("_welcome/_signedIn/_organization.tsx"),
        children: [
          {
            type: "route",
            path: "organization-setup",
            file: routeFile(
              "_welcome/_signedIn/_organization/organization-setup.tsx",
            ),
          },
          {
            type: "route",
            path: "organization-pending",
            file: routeFile(
              "_welcome/_signedIn/_organization/organization-pending.tsx",
            ),
          },
        ],
      },
    ],
    organizationDashboard: [
      {
        type: "layout",
        id: "_padded",
        file: routeFile("_authenticated/_organization/_dashboard/_padded.tsx"),
        children: [
          {
            type: "route",
            path: "checkout/success",
            file: routeFile(
              "_authenticated/_organization/_dashboard/_padded/checkout.success.tsx",
            ),
          },
          {
            type: "route",
            path: "billing/suspended",
            file: routeFile(
              "_authenticated/_organization/_dashboard/_padded/billing_.suspended.tsx",
            ),
          },
          {
            type: "layout",
            id: "_admin",
            file: routeFile(
              "_authenticated/_organization/_dashboard/_padded/_admin.tsx",
            ),
            children: [
              {
                type: "route",
                path: "billing",
                file: routeFile(
                  "_authenticated/_organization/_dashboard/_padded/_admin/billing.tsx",
                ),
              },
            ],
          },
        ],
      },
    ],
  },
};
