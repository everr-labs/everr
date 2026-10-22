import { APIError } from "better-auth/api";
import { IdentityPolicyError } from "./policy-error";

/** Keep provider response types out of application policy implementations. */
export async function enforceIdentityPolicy<T>(
  run: () => T | Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof IdentityPolicyError) {
      throw new APIError("FORBIDDEN", { message: error.message });
    }
    throw error;
  }
}
