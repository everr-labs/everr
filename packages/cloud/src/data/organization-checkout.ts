import * as z from "zod";
import { billing } from "../billing/server";
import { auth } from "@everr/app/lib/auth.server";
import { createPartiallyAuthenticatedServerFn } from "@everr/app/lib/serverFn";

const CheckoutResultSchema = z.object({ checkoutId: z.string().min(1) });

export const completeProOrganizationCheckout =
  createPartiallyAuthenticatedServerFn({ method: "POST" })
    .inputValidator(CheckoutResultSchema)
    .handler(async ({ data, context: { session } }) => {
      return billing.completeNewOrganizationCheckout(
        data.checkoutId,
        session.user.id,
        (input) => auth.api.createOrganization(input),
      );
    });
