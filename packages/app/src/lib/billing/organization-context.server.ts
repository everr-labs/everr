import { AsyncLocalStorage } from "node:async_hooks";

// Only the verified checkout finalizer can supply an ID. Never read this from
// request input or organization metadata supplied to the public auth endpoint.
const creationContext = new AsyncLocalStorage<{
  id: string;
  slug: string;
  ownerId: string;
}>();

export function withOrganizationCreationId<T>(
  context: { id: string; slug: string; ownerId: string },
  run: () => Promise<T>,
) {
  return creationContext.run(context, run);
}

export async function beforeCreateCheckoutOrganization({
  organization,
  user,
}: {
  organization: { slug?: string };
  user: { id: string };
}) {
  const context = creationContext.getStore();
  if (!context) return;
  if (organization.slug !== context.slug || user.id !== context.ownerId)
    throw new Error("Organization creation context mismatch");
  return { data: { id: context.id } };
}
