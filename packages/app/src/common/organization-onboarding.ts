import { z } from "zod";

export const organizationReturnToSchema = z
  .string()
  .refine(
    (value) =>
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !value.includes("\\") &&
      [...value].every(
        (char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127,
      ) &&
      !value.startsWith("/organization-setup") &&
      !value.startsWith("/create-organization") &&
      !value.startsWith("/choose-organization"),
  )
  .catch("/");

export function isMissingOrganizationError(cause: unknown) {
  if (!(cause instanceof Error)) return false;
  const message = cause.message.toLowerCase();
  return (
    message.includes("not a member") ||
    message.includes("organization not found") ||
    message.includes("no active organization")
  );
}

export function newAccountDestination(returnTo = "/") {
  const destination = organizationReturnToSchema.parse(returnTo);
  const pathname = destination.split(/[?#]/)[0];
  // Invitations, device approval, and checkout have their own continuation
  // flows that must remain accessible before organization setup is complete.
  if (
    /^\/invite\/[^/]+\/?$/.test(pathname) ||
    [
      "/device",
      "/organizations/checkout/success",
      "/checkout/success",
    ].includes(pathname)
  )
    return destination;
  return `/organization-setup?${new URLSearchParams({ returnTo: destination })}`;
}
