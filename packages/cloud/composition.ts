import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppComposition } from "@everr/app/build/composition";

const routeFile = (file: string) =>
  resolve(import.meta.dirname, "src/routes", file);

export const cloudComposition: AppComposition = {
  directory: import.meta.dirname,
  cssSources: [resolve(import.meta.dirname, "./src")],
  modules: {
    server: fileURLToPath(new URL("./src/runtime.ts", import.meta.url)),
    client: fileURLToPath(
      new URL("./src/composition/client.tsx", import.meta.url),
    ),
    product: fileURLToPath(
      new URL("./src/composition/product.ts", import.meta.url),
    ),
    pages: fileURLToPath(
      new URL("./src/composition/pages.tsx", import.meta.url),
    ),
    ui: fileURLToPath(new URL("./src/composition/ui.tsx", import.meta.url)),
    navigation: fileURLToPath(new URL("./src/navigation.ts", import.meta.url)),
    dashboards: fileURLToPath(new URL("./src/dashboards.ts", import.meta.url)),
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
  routeTree: fileURLToPath(new URL("./src/routeTree.gen.ts", import.meta.url)),
};
