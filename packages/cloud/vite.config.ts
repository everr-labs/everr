import { resolve } from "node:path";
import { createAppConfig } from "@everr/app/build";
import { cloudComposition } from "./composition";

export default createAppConfig(
  cloudComposition,
  resolve(import.meta.dirname, "./.output"),
);
