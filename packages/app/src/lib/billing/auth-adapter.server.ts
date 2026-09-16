import type { drizzleAdapter } from "better-auth/adapters/drizzle";
import { z } from "zod";
import { withBillingRequest } from "./lock.server";
import { billing } from "./server";

// A database update carries the actual target predicate. Session-based hooks
// cannot identify email-verification targets when the browser is signed out.
export function billingIdentityAdapter(
  factory: ReturnType<typeof drizzleAdapter>,
) {
  return (options: Parameters<typeof factory>[0]) => {
    const adapter = factory(options);
    const update: typeof adapter.update = async <T>(
      input: Parameters<typeof adapter.update>[0],
    ): Promise<T | null> => {
      if (input.model !== "user") return adapter.update<T>(input);
      const identity = z
        .object({
          name: z.string().optional(),
          email: z.string().optional(),
          emailVerified: z.boolean().optional(),
        })
        .parse(input.update);
      if (identity.name === undefined && identity.email === undefined)
        return adapter.update<T>(input);
      return withBillingRequest(async () => {
        const user = await adapter.findOne<{ id: string }>({
          model: "user",
          where: input.where,
        });
        if (!user) return adapter.update<T>(input);
        await billing.beforeUserUpdate(user.id, identity);
        const result = await adapter.update<T>(input);
        await billing.afterUserUpdate(user.id);
        return result;
      });
    };
    return { ...adapter, update };
  };
}
