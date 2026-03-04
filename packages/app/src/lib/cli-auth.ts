import { getBearerToken, validateAccessToken } from "@/lib/access-token-auth";

export type ValidCliAuth = {
  tenantId: number;
  organizationId: string;
  userId: string;
};

export { getBearerToken };

export async function validateCliAuthToken(
  token: string,
): Promise<ValidCliAuth | null> {
  const validated = await validateAccessToken(token);
  if (!validated) {
    return null;
  }

  return {
    tenantId: validated.tenantId,
    organizationId: validated.organizationId,
    userId: validated.userId,
  };
}
