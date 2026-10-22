import { createPartiallyAuthenticatedServerFn } from "@everr/app/lib/serverFn";
import * as z from "zod";
import { organizationCommands } from "../organizations/commands.server";

const CheckoutResultSchema = z.object({ checkoutId: z.string().min(1) });

export const completeProOrganizationCheckout = createPartiallyAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(CheckoutResultSchema)
  .handler(async ({ data, context: { session } }) => {
    return organizationCommands.completeCheckout({
      checkoutId: data.checkoutId,
      actorId: session.user.id,
    });
  });
