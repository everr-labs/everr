import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { OrganizationSetup } from "@/components/organization-setup";

const returnToSchema = z
  .string()
  .refine(
    (value) =>
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !value.includes("\\") &&
      [...value].every(
        (char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127,
      ) &&
      !value.startsWith("/organization-setup"),
  )
  .catch("/");

export const Route = createFileRoute("/_authenticated/organization-setup")({
  validateSearch: z.object({ returnTo: returnToSchema.default("/") }),
  beforeLoad: ({ context, search }) => {
    if (context.clickhouseReady)
      throw redirect({ href: search.returnTo, replace: true });
  },
  head: () => ({ meta: [{ title: "Everr - Organization setup" }] }),
  component: OrganizationSetup,
});
