import { server } from "@composition/server";

const { canOpenSignup: checkSignup } = server;

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
export const canOpenSignup = createServerFn({ method: "GET" })
  .inputValidator(z.object({ redirect: z.string().optional() }))
  .handler(({ data }) => checkSignup(data));
