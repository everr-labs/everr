import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { createAuthClient } from "better-auth/client";
import { auth } from "@/lib/auth.server";

function createMcpResourceClient() {
  return createAuthClient({ plugins: [oauthProviderResourceClient(auth)] });
}

let cached: ReturnType<typeof createMcpResourceClient> | undefined;
export function mcpResourceClient() {
  if (!cached) {
    cached = createMcpResourceClient();
  }
  return cached;
}
