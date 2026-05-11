# Sending Telemetry to Everr

Everr accepts standard OpenTelemetry (OTLP) traces, metrics and logs from any
SDK or collector. Telemetry is per-tenant: every request must be authenticated
with an **ingest key** scoped to your organization.

## 1. Mint an ingest key

In the Everr dashboard, go to **Settings → Ingest Keys** and click *New key*.

- Keys are organization-scoped: any data sent with the key is attributed to the
  organization it belongs to.
- The full key is shown **once**, at creation time. Copy it into your secret
  manager — you can't retrieve it later.
- Admins can revoke a key at any time; revocation is effective within ~30s
  (the collector's positive cache TTL).

## 2. Endpoints

| Protocol | URL                          |
|----------|------------------------------|
| OTLP HTTP | `https://ingest.everr.dev/`  |
| OTLP gRPC | `https://ingest.everr.dev:4317` |

Send the key as a bearer token in the `Authorization` header:

```
Authorization: Bearer <your-ingest-key>
```

Requests without a valid key get **401 Unauthorized**. Requests over the
per-key rate limit get **429**.

> **Note on tenant attribution.** If you set an `everr.tenant.id` resource
> attribute in your SDK, it will be **stripped and overwritten** with the value
> derived from your key. Tenant identity comes from the key, not from the
> client.

## 3. Example: Node.js / TypeScript

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: "https://ingest.everr.dev/v1/traces",
    headers: { Authorization: `Bearer ${process.env.EVERR_INGEST_KEY}` },
  }),
});

sdk.start();
```

## 4. Example: Python

```python
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
import os

provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(
    endpoint="https://ingest.everr.dev/v1/traces",
    headers={"Authorization": f"Bearer {os.environ['EVERR_INGEST_KEY']}"},
)))
```

## 5. Example: environment-variable form

Most OTel SDKs honour the standard env vars, so for many runtimes you don't
need any code changes:

```sh
export OTEL_EXPORTER_OTLP_ENDPOINT="https://ingest.everr.dev"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${EVERR_INGEST_KEY}"
```

## 6. Forwarding from your own collector

If you already run an OpenTelemetry Collector, point its OTLP exporter at
Everr:

```yaml
exporters:
  otlphttp/everr:
    endpoint: https://ingest.everr.dev
    headers:
      Authorization: "Bearer ${env:EVERR_INGEST_KEY}"
```

## 7. Limits

Each key has its own rate limit (configurable per key in the dashboard). When
exceeded, the collector returns 429. Drop new spans rather than retrying in a
tight loop — most OTel SDKs already do this with exponential backoff.

## 8. Troubleshooting

- **401:** key is missing, malformed, revoked, expired, or not of kind
  `ingest`.
- **429:** rate limit exceeded for this key.
- **5xx:** transient — the SDK should retry with backoff.
- **Telemetry shows up under a different tenant than expected:** confirm
  you're using the right key. The tenant attribute in your SDK config is
  ignored — only the key determines tenancy.
