-- The __VALIDATION_RUN_ID__ token is replaced before this fixture is copied
-- to the test container. Keeping its replacement constant makes byteSize
-- golden assertions deterministic.

INSERT INTO otel.otel_traces
  (Timestamp, TraceId, SpanId, SpanName, ServiceName, ResourceAttributes, Duration)
VALUES
  (now64(9, 'UTC'), 'trace-a', 'span-a', 'request', 'usage-test',
   map('everr.tenant.id', 'tenant-a',
       'everr.usage.validation.run_id', '__VALIDATION_RUN_ID__'), 1250000);

INSERT INTO otel.otel_logs
  (Timestamp, TimestampTime, TraceId, SpanId, SeverityText, SeverityNumber,
   ServiceName, Body, ResourceAttributes, LogAttributes, EventName)
VALUES
  (now64(9, 'UTC'), now('UTC'), 'trace-a', 'span-a', 'INFO', 9,
   'usage-test', 'metered log',
   map('everr.tenant.id', 'tenant-a',
       'everr.usage.validation.run_id', '__VALIDATION_RUN_ID__'),
   map('everr.test.attribute', 'log-value'), 'usage.test');

INSERT INTO otel.otel_metrics_gauge
  (ResourceAttributes, ServiceName, MetricName, MetricDescription,
   MetricUnit, Attributes, StartTimeUnix, TimeUnix, Value)
VALUES
  (map('everr.tenant.id', 'tenant-a',
       'everr.usage.validation.run_id', '__VALIDATION_RUN_ID__'),
   'usage-test', 'test.gauge',
   'gauge description', 'ms', map('everr.test.route', '/gauge'),
   now64(9, 'UTC'), now64(9, 'UTC'), 12.5);

INSERT INTO otel.otel_metrics_sum
  (ResourceAttributes, ServiceName, MetricName, MetricDescription,
   MetricUnit, Attributes, StartTimeUnix, TimeUnix, Value,
   AggregationTemporality, IsMonotonic)
VALUES
  (map('everr.tenant.id', 'tenant-a',
       'everr.usage.validation.run_id', '__VALIDATION_RUN_ID__'),
   'usage-test', 'test.sum',
   'sum description', 'requests', map('everr.test.route', '/sum'),
   now64(9, 'UTC'), now64(9, 'UTC'), 7, 2, true);

INSERT INTO otel.otel_metrics_histogram
  (ResourceAttributes, ServiceName, MetricName, MetricDescription,
   MetricUnit, Attributes, StartTimeUnix, TimeUnix, Count, Sum,
   BucketCounts, ExplicitBounds, Flags, Min, Max, AggregationTemporality)
VALUES
  (map('everr.tenant.id', 'tenant-a',
       'everr.usage.validation.run_id', '__VALIDATION_RUN_ID__'),
   'usage-test', 'test.histogram',
   'histogram description', 'ms', map('everr.test.route', '/histogram'),
   now64(9, 'UTC'), now64(9, 'UTC'), 2, 15,
   [1, 1], [5], 0, 5, 10, 2);

INSERT INTO otel.otel_metrics_exponential_histogram
  (ResourceAttributes, ServiceName, MetricName, MetricDescription,
   MetricUnit, Attributes, StartTimeUnix, TimeUnix, Count, Sum, Scale,
   ZeroCount, PositiveOffset, PositiveBucketCounts, NegativeOffset,
   NegativeBucketCounts, Flags, Min, Max, AggregationTemporality)
VALUES
  (map('everr.tenant.id', 'tenant-a',
       'everr.usage.validation.run_id', '__VALIDATION_RUN_ID__'),
   'usage-test',
   'test.exponential_histogram', 'exponential histogram description', 'ms',
   map('everr.test.route', '/exponential-histogram'), now64(9, 'UTC'),
   now64(9, 'UTC'), 3, 18, 2, 1, 0, [1, 1], 0, [0], 0, 2, 9, 2);

INSERT INTO otel.otel_metrics_summary
  (ResourceAttributes, ServiceName, MetricName, MetricDescription,
   MetricUnit, Attributes, StartTimeUnix, TimeUnix, Count, Sum,
   `ValueAtQuantiles.Quantile`, `ValueAtQuantiles.Value`, Flags)
VALUES
  (map('everr.tenant.id', 'tenant-a',
       'everr.usage.validation.run_id', '__VALIDATION_RUN_ID__'),
   'usage-test', 'test.summary',
   'summary description', 'ms', map('everr.test.route', '/summary'),
   now64(9, 'UTC'), now64(9, 'UTC'), 2, 12, [0.5, 0.9], [5, 7], 0);
