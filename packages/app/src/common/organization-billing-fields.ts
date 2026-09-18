// Better Auth exposes the stored reference but never accepts it from clients.
export const organizationBillingFields = {
  polarCustomerId: { type: "string", required: false, input: false },
} as const;
