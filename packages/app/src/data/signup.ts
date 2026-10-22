import { entry } from "@composition/entry";

const { canOpenSignup: checkSignup } = entry;

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
export const canOpenSignup = createServerFn({ method: "GET" })
  .inputValidator(z.object({ redirect: z.string().optional() }))
  .handler(({ data }) => checkSignup(data));
