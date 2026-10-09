import { z } from "zod";

export const returnToSchema = z
  .string()
  .refine(
    (value) =>
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !value.includes("\\") &&
      [...value].every(
        (char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127,
      ) &&
      !value.startsWith("/organization-pending") &&
      !value.startsWith("/organization-setup") &&
      !value.startsWith("/create-organization") &&
      !value.startsWith("/choose-organization"),
  )
  .catch("/");
