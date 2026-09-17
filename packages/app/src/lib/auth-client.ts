import { apiKeyClient } from "@better-auth/api-key/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { polarClient } from "@polar-sh/better-auth/client";
import {
  deviceAuthorizationClient,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { organizationBillingFields } from "@/common/organization-billing-fields";

export const authClient = createAuthClient({
  plugins: [
    organizationClient({
      schema: { organization: { additionalFields: organizationBillingFields } },
    }),
    apiKeyClient(),
    deviceAuthorizationClient(),
    polarClient(),
    oauthProviderClient(),
  ],
});
