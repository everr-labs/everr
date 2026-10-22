import { productClient } from "@composition/client";
import { z } from "zod";

export const returnToSchema = z
  .string()
  .refine(
    (value) =>
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !value.includes("\\") &&
      value.split("").every((char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127) &&
      !productClient.entryRoutes.some((path) => value.startsWith(path)),
  )
  .catch("/");
