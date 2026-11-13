import { defineServerEntry } from "nitro";
import { parseTrustProxy } from "./src/lib/trust-proxy";

// Nitro's server entry: only listener options, no fetch handler, so every request
// still goes to TanStack Start. Read at startup, so TRUST_PROXY is runtime config
export default defineServerEntry({
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
});
