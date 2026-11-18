---
"@everr/otel-web": patch
---

The network instrumentation no longer logs "Refused to get unsafe header \"x-everr-route\"" in the browser console for XHR requests to other origins, such as third-party services. A cross-origin API that exposes the header with `Access-Control-Expose-Headers` still reports its route.
