import { initTRPC } from "@trpc/server";
import SuperJSON from "superjson";

export const t = initTRPC.create({
  transformer: SuperJSON,
});
