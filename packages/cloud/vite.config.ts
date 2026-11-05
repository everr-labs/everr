import { resolve } from "node:path";
import { createAppConfig } from "@everr/app/build";
import { termsDocument } from "./build/terms";
import { cloudComposition } from "./composition";

export default createAppConfig(cloudComposition, resolve(import.meta.dirname, "./.output"), [
  termsDocument(resolve(import.meta.dirname, "../docs/content/legal/terms.mdx")),
]);
