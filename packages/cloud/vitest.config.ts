import { resolve } from "node:path";
import { createAppTestConfig } from "@everr/app/testing/config";
import { cloudComposition } from "./composition";

export default createAppTestConfig(cloudComposition, resolve(import.meta.dirname, "./"));
