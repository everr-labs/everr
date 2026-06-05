# Metrics

Metrics are timestamped numerical measurements aggregated over time. Use them for alerting, SLOs, dashboards, trend analysis, rates, and capacity planning.

Before creating a custom metric, check the OpenTelemetry semantic conventions for the domain. Many common measurements are already defined, including HTTP request duration, database operation duration, connection-pool state, runtime memory, and runtime garbage collection. Use semantic convention metrics when they exist so auto-instrumentation, dashboards, alerts, and queries share one contract.

Create a custom metric only when no semantic convention or installed instrumentation already covers the measurement.

## Metrics From Automatic Instrumentation

Some auto-instrumentation packages emit semantic convention metrics without custom code. Before adding a metric, verify that the project is not already emitting it.

Duplicating an auto-instrumented metric creates conflicting data and usually makes queries and dashboards harder to reason about.

### Find Installed Instrumentation

Check the project's dependencies and runtime startup path:

| Language | Where to check | Example instrumentation |
| --- | --- | --- |
| Node.js | `dependencies` in `package.json`, `NODE_OPTIONS`, instrumentation file | `@opentelemetry/instrumentation-http`, `@opentelemetry/instrumentation-express` |
| Python | `requirements.txt`, `pyproject.toml`, `setup.cfg` | Flask, Django, requests, SQLAlchemy instrumentation |
| Go | `go.mod`, imports under `go.opentelemetry.io/contrib/instrumentation/` | `otelhttp`, gRPC, database wrappers |
| PHP | `composer.json` | framework and HTTP instrumentation packages |

### Common Auto-Instrumented Metrics

When these instrumentations are present, expect metrics in these domains before writing custom ones:

| Domain | Common metric names |
| --- | --- |
| HTTP server | `http.server.request.duration`, `http.server.active_requests` |
| HTTP client | `http.client.request.duration` |
| Database client | `db.client.operation.duration` |
| Messaging | `messaging.process.duration`, `messaging.publish.duration` |
| RPC | `rpc.server.duration`, `rpc.client.duration` |
| Runtime/process | `process.runtime.*`, `process.cpu.*`, `process.memory.*` |

Exact names can vary by SDK version and semantic convention stability setting. If a service depends on a metric for alerts or dashboards, test the emitted shape instead of assuming the library uses the current stable name.

### Decision Process

Follow this order before creating a metric:

1. List installed instrumentation libraries and startup hooks.
2. Check which metrics those libraries emit.
3. Check what we already have by querying both the local collector and the cloud.
4. Check OpenTelemetry semantic conventions for the same domain.
5. If the measurement already exists, use that metric and only add attributes allowed by the semantic convention.
6. If the measurement is domain-specific or not covered, create a custom metric following the naming, unit, and cardinality rules below.

```javascript
// BAD: duplicates common HTTP instrumentation.
const requestDuration = meter.createHistogram('http.server.request.duration', {
  unit: 's',
});

// GOOD: domain-specific metric not covered by HTTP instrumentation.
const orderValue = meter.createHistogram('orders.value', {
  unit: '{USD}',
});
```

### Choose The Right Instrument

Use this decision tree:

1. If measuring duration or size and percentiles matter, use a Histogram.
   Do not model total duration as a Counter; that loses the distribution.
2. If counting events or bytes that only increase, use a Counter.
   Query rates from the counter later.
3. If tracking something that increases and decreases, use an UpDownCounter.
   Increment when the resource is acquired and decrement when released.
4. If observing a current value that should not be summed across instances, use a Gauge.
   Prefer asynchronous/observable gauges when reading from another subsystem at collection time.

### Synchronous vs Asynchronous

- Use synchronous instruments when code controls the measurement moment, such as `counter.add(1)` in a request handler.
- Use asynchronous instruments when the SDK should poll a current value, such as memory usage, connection-pool size, or queue depth.

## RED Metrics

RED means rate, errors, and duration. Prefer deriving RED signals from semantic convention metrics:

- HTTP server latency and request count can come from `http.server.request.duration`.
- HTTP error rate can be queried from request duration attributes such as status code/class when emitted.
- RPC, messaging, and database domains have their own semantic convention metric families.

For headless work such as cron jobs, batch jobs, and background workers, create domain-specific metrics only when no semantic convention metric fits. Name them using the same principles as semantic convention metrics: stable namespace, operation noun, and no embedded unit.

## Creating Custom Metrics

Use custom metrics for business or domain measurements, not for reimplementing HTTP, database, runtime, or messaging instrumentation.

Avoid creating custom metrics in a semantic convention namespace such as `http`, `db`, `rpc`, `messaging`, `process`, or `system` unless the project is intentionally filling a missing semantic convention metric and has a plan to remove the custom metric when instrumentation catches up.

### Naming Rules

- Check semantic conventions first.
- Use stable names that describe the measurement, not the implementation.
- Do not include units in metric names; units belong in the unit field.
- Do not use a metric name that matches a semantic convention attribute key.
- Use a project/domain namespace for custom metrics, such as `orders.processed` or `billing.invoice.amount`.

Examples:

```text
http.server.request.duration    # semantic convention histogram, unit s
http.server.active_requests     # semantic convention UpDownCounter
system.cpu.utilization          # semantic convention gauge
orders.processed                # custom counter, unit 1
orders.value                    # custom histogram, unit {USD}
```

Bad names:

```text
orders.value.usd
http.response.status_code
my_app.request.duration.seconds
```

## Units

Always set a unit with UCUM notation. Metrics without units are ambiguous.

| Unit | Meaning |
| --- | --- |
| `s` | seconds |
| `ms` | milliseconds |
| `By` | bytes |
| `1` | dimensionless count or ratio |
| `{USD}` | annotation unit for US dollars |

Rules:

- All producers of the same metric name must use the same unit.
- Do not mix `s` and `ms` for the same metric name.
- All producers of the same histogram metric should use compatible bucket boundaries.
- Use the semantic convention unit when one exists.

## Cardinality Management

Metric attributes create time series. Each added attribute multiplies the number of series by the number of distinct values for that attribute.

Example:

```text
http.request.method:        5 values
http.route:                50 values
http.response.status_class: 5 values
service.instance.id:       10 instances
```

Total: `5 * 50 * 5 * 10 = 12,500` time series.

Use this rough scale:

| Series count | Zone | Action |
| --- | --- | --- |
| `< 1,000` | Minimal | Safe for most services |
| `1,000 - 10,000` | Healthy | Good detail/cost balance |
| `10,000 - 50,000` | Acceptable | Monitor growth |
| `50,000 - 100,000` | Caution | Review attributes |
| `> 100,000` | Danger | Remove unbounded attributes |
| `> 1,000,000` | Critical | Fix before production use |

Never use these as metric attributes:

- `user.id`
- `request.id`
- `order.id`
- `account.id`
- `trace_id`
- `span_id`
- `url.full`
- raw `http.path`
- timestamp
- IP address
- email
- token or session identifier
- exception message
- stack trace

Prefer bounded attributes:

- `http.request.method`
- `http.route`
- `url.template`
- status class such as `2xx`, `4xx`, `5xx`
- bounded feature flag key or variant
- bounded plan/tier
- job name from a fixed set

### Normalize Before Attaching

Normalize high-cardinality values before considering them for metric attributes.

```javascript
// URL path: /users/123/orders/456 -> /users/{id}/orders/{id}
path.replace(/\/\d+/g, '/{id}');

// SQL text: SELECT * FROM orders WHERE id=99 -> SELECT orders
query.replace(/\bWHERE\b.*/i, '').trim();
```

Prefer framework route templates (`http.route`) over regex normalization when available.

## Attribute Placement

Signals have different cardinality tolerance:

| Signal | Attribute guidance |
| --- | --- |
| Metrics | Small, bounded attributes only |
| Spans | Higher-cardinality values are acceptable when safe and useful |
| Logs | Best for detailed, rare, high-cardinality facts |

Values such as user ids, order ids, request ids, and trace ids usually belong on spans or logs, not metrics.

## Flushing On Shutdown Or Crash

Most SDKs batch metrics before export. If the process exits before the reader/exporter flushes, recent metric points can be lost.

Every runtime service should preserve normal shutdown behavior while flushing telemetry:

- Shut down or flush metric readers/providers on graceful shutdown.
- For crash handlers, flush with a short timeout and preserve the original failure behavior.
- Accept that `SIGKILL`, OOM kills, and segfaults bypass in-process shutdown hooks.

Use runtime-specific guidance, such as `nodejs.md`, for the concrete shutdown pattern.

## Testing Metric Data

Treat metric shape as a contract. Dashboards, alerts, SLOs, and cost expectations depend on metric name, type, unit, and attribute keys.

Use an in-memory exporter in integration tests when a metric is important to user-facing behavior or alerting.

### Every Metric Has A Unit

Assert that every emitted metric descriptor has a non-empty unit.

```typescript
async function assertAllMetricsHaveUnits() {
  const resourceMetrics = await collectMetrics();
  const missing: string[] = [];

  for (const resourceMetric of resourceMetrics) {
    for (const scopeMetric of resourceMetric.scopeMetrics) {
      for (const metric of scopeMetric.metrics) {
        if (!metric.descriptor.unit) {
          missing.push(metric.descriptor.name);
        }
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(`Metrics without a unit: ${missing.join(', ')}`);
  }
}
```

### Metric Shape Must Not Drift

Write one test per important metric. Assert:

- name
- instrument type
- unit
- exact attribute-key set

```typescript
function findMetricShape(name: string) {
  for (const resourceMetric of exporter.getMetrics()) {
    for (const scopeMetric of resourceMetric.scopeMetrics) {
      for (const metric of scopeMetric.metrics) {
        if (metric.descriptor.name !== name) continue;

        const attributeKeys = new Set<string>();
        for (const point of metric.dataPoints) {
          for (const key of Object.keys(point.attributes)) {
            attributeKeys.add(key);
          }
        }

        return {
          name: metric.descriptor.name,
          type: metric.descriptor.type,
          unit: metric.descriptor.unit,
          attributeKeys: [...attributeKeys].sort(),
        };
      }
    }
  }
  return undefined;
}

it('orders.value has the expected shape', async () => {
  await placeOrder({ method: 'credit_card', total: 49.99 });
  await reader.forceFlush();

  expect(findMetricShape('orders.value')).toEqual({
    name: 'orders.value',
    type: 'HISTOGRAM',
    unit: '{USD}',
    attributeKeys: ['payment.method'],
  });
});
```

When a metric-shape test fails:

- Name changed: update dashboards and alerts before accepting.
- Type changed: verify the new instrument actually matches the measurement.
- Unit changed: verify all consumers and producers use the same unit.
- Attribute key added: calculate cardinality before accepting.
- Attribute key removed: confirm no dashboard, alert, or query depends on it.

### Auto-Instrumented Metrics Must Be Tested

Auto-instrumentation can lag behind stable semantic conventions. For metrics the service depends on, assert the emitted semantic convention shape.

```typescript
it('http.server.request.duration has the expected shape', async () => {
  await sendRequest('GET', '/health');
  await reader.forceFlush();

  expect(findMetricShape('http.server.request.duration')).toEqual({
    name: 'http.server.request.duration',
    type: 'HISTOGRAM',
    unit: 's',
    attributeKeys: [
      'http.request.method',
      'http.response.status_code',
      'http.route',
    ],
  });
});
```

If an instrumentation library emits outdated names, units, or attributes:

1. Prefer a library option that enables stable semantic conventions.
2. If unavailable and the metric is required, create the stable metric manually in application code.
3. Drop the outdated metric in the collector or telemetry pipeline when possible, rather than coupling application code to SDK internals.
4. Document the workaround and the library version that required it.
5. Remove the manual metric once the library emits the stable shape.

Do not solve outdated auto-instrumented metrics by silently changing dashboard queries to unstable names unless the team accepts that as the contract.

## Anti-Patterns

### Unbounded Metric Labels

```javascript
// BAD: one series per user.
counter.add(1, { user_id: userId });

// GOOD: small bounded set.
counter.add(1, { user_tier: 'premium' });
```

### Unit In Metric Name

```javascript
// BAD
meter.createHistogram('checkout.duration.ms', { unit: 'ms' });

// GOOD
meter.createHistogram('checkout.duration', { unit: 'ms' });
```

### Metric Per Outcome String

```javascript
// BAD: names grow with outcomes.
meter.createCounter(`orders.${status}`);

// GOOD: one metric with bounded status attribute.
meter.createCounter('orders.processed').add(1, { 'order.status': status });
```
