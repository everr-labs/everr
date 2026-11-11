# OpenTelemetry Collector upgrade: v0.160.0 to v0.165

This records what changed upstream between the collector we pinned and the one we
moved to, and what that meant for this repository. Use it to review the bump.

|                                             | Before             | After              |
| ------------------------------------------- | ------------------ | ------------------ |
| Core (`go.opentelemetry.io/collector`)      | v0.160.0 / v1.66.0 | v0.165.0 / v1.71.0 |
| Contrib (`opentelemetry-collector-contrib`) | v0.160.0           | v0.165.1           |
| Builder (`ocb`) and `mdatagen`              | v0.160.0           | v0.165.0           |

## Profiles are still alpha

- `service.profilesSupport` is still an alpha feature gate in v0.165.0, unchanged
  since v0.112.0. The profiles work that follows this bump still needs it.
- The OTLP proto still has only `profiles/v1development` (opentelemetry-proto
  v1.11.1). There is no beta or stable profiles schema yet.

## What changed in this repository

- Every collector Go module (`collector/**/go.mod`) and both builder manifests
  (`collector/config/manifest.cloud.yaml`, `manifest.self-hosted.yaml`) are on the
  versions above. Our own module placeholders moved from v0.160.0 to v0.165.0.
- `go.opentelemetry.io/collector/config/confighttp` is now a stable module
  (v1.71.0, no longer v0.x).
- `github.com/open-telemetry/opentelemetry-collector-contrib/pkg/pdatautil` was
  removed upstream (contrib v0.162.0); it was only an indirect dependency and
  `go mod tidy` dropped it.
- The chDB exporter fork (`collector/exporter/chdbexporter`) is merged up to
  upstream `exporter/clickhouseexporter` v0.165.1. Details are below and in
  `collector/exporter/chdbexporter/EVERR_CHANGES.md`.
- The fork's `localSchemaVersion` is 4. Every local store rebuilds its tables on
  first start, which drops its cached telemetry (bounded by the 7-day TTL).
- Version references in comments: `collector/extension/everrusageextension/README.md`,
  `collector/cmd/everr-local-collector/main.go`. The header of
  `packages/app/clickhouse/0003-create-otel-tables.sql` still names v0.160.0: that
  migration is applied, and any edit to it, a comment included, stops startup.

Nothing changed in the cloud ClickHouse schema. Upstream changed no columns and no
insert statements between these versions; the only DDL changes are codecs and one
index, and we create our tables ourselves (`create_schema: false`).

## Verified

- `make test-all` and `make lint-all` pass for every collector module (lint with
  `GOTOOLCHAIN=go1.26.2`; golangci-lint v1.64.8 cannot read Go 1.27 export data).
- `make build` for cloud and self-hosted, and `make build-local`.
- `everr-collector validate` passes for `collector/config.example.yml`.
  `deploy/collector.yaml` gives the same result as the v0.160 binary with
  placeholder environment values.
- The dev stack's collectors were restarted on the new build and kept ingesting
  traces, metrics, and profiles from a Node and a Go service. That check ran on
  the profiles branch, which is stacked on this one.

## Things to watch

1. **ClickHouse connection pool (contrib v0.165.0, `exporter/clickhouse`).** The
   pool is now sized from `sending_queue.num_consumers`. Our collectors set
   `num_consumers: 10`, so each exporter opens about 10 connections, and the
   metrics exporter one per metric type per consumer (up to about 50). Multiply
   by replicas and compare with the server's connection limit, or set
   `max_open_conns` / `max_idle_conns` in the endpoint or `connection_params`.
2. **Profiles schema version metadata (core v0.163.0, `pkg/pprofile`).** The OTLP
   receiver now rejects malformed, repeated, or unsupported profiles versions.
   Clients that send no version are treated as the initial development version.
   The profilers in the profiles work send none, and ingestion was verified. When
   the profiles proto moves past v1development, they need to follow.
3. **`xhash` values changed (core v0.163.0, `pkg/xpdata`).** Anything that
   persisted hashes from `xhash` would see different values. We do not.
4. **`ZSTD(3)` default codec (contrib v0.165.0).** Only affects tables the
   exporter creates: the local chDB store after this bump, not cloud.
5. **Removed settings.** `confighttp` dropped `IdleConnTimeout`, `MaxIdleConns`,
   `MaxIdleConnsPerHost`, `DisableKeepAlives` (core v0.165.0); OTTL dropped
   `Base64Decode` (contrib v0.161.0); the filter processor's
   `defaultErrorModeIgnore` gate is gone (contrib v0.164.0). None are used in our
   configs; every filter processor sets `error_mode` explicitly.
6. **`queuebatch` processor renamed to `queue_batch` (core v0.162.0)** and
   promoted to beta for traces, metrics, logs and alpha for profiles (core
   v0.165.0). We use `batch`, not this processor.

## Profiles-related changes, in one place

- Core v0.161.0: `pkg/pprofile` removed deprecated `AggregationTemporality`,
  `Duration`, `SetDuration`; resource and scope attribute strings now go through
  the profiles dictionary string table; inline attribute keys are no longer erased.
- Core v0.162.0: much faster profiles dictionary merging during batching.
- Core v0.163.0: profiles development-version metadata in the OTLP receiver and
  exporters; batching drops only an oversized profile instead of everything queued
  behind it; OTLP/gRPC interns attribute strings like OTLP/HTTP.
- Core v0.165.0: the OTLP receiver reports accepted, refused, and failed profile
  samples per sample type (`otelcol_receiver_*_profile_samples` with
  `sample_type`); `xprocessorhelper.NewProfiles` gets the standard processor
  metrics; `queue_batch` supports profiles (alpha).
- Contrib v0.162.0: OTTL profiles support moved to `pkg/ottl/contexts/xprofile`,
  outside OTTL's stability guarantees.
- Contrib v0.164.0: `pkg/translator/pprof` returns an error instead of panicking on
  invalid profile references.

## Upstream ClickHouse exporter, v0.160.0 to v0.165.1

| Release  | Change                                                                                                      | Cloud and self-hosted (upstream exporter)             | Local app (chDB fork)                            |
| -------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| v0.163.0 | `database_engine` option for `CREATE DATABASE`; no `ON CLUSTER` on table DDL inside a `Replicated` database | No effect: the exporter does not create our databases | Merged; unused                                   |
| v0.164.0 | `idx_event_name` bloom filter index on logs `EventName`                                                     | No effect: `create_schema: false`                     | Merged; part of the local rebuild                |
| v0.165.0 | Connection pool sized from `sending_queue.num_consumers`                                                    | **Applies**, see "Things to watch"                    | Config code merged; the chDB adapter has no pool |
| v0.165.0 | Default column codec `ZSTD(1)` to `ZSTD(3)`                                                                 | No effect: `create_schema: false`                     | Merged; part of the local rebuild                |

The fork keeps its documented differences: bloom filter indexes instead of text
indexes, no `TraceId` skip index on `traces_trace_id_ts`, its own sort keys, and
`JSON(max_dynamic_paths = 256)`.

## Core changelog (opentelemetry-collector), every entry

### Core v0.161.0 (2026-09-14)

Full notes: https://github.com/open-telemetry/opentelemetry-collector/releases/tag/v0.161.0

#### End User Changelog

##### 🛑 Breaking changes 🛑

- `pkg/pprofile`: Remove deprecated AggregationTemporality, Duration, SetDuration (#15855)
- `pkg/scraperhelper/controller`: Remove deprecated AddScraper func (#15934)
- `pkg/service`: Remove deprecated ZapOptions (#15935)
- `pkg/xconfmap`: Remove deprecated WithForceUnmarshaler func (#15932)

##### 💡 Enhancements 💡

- `pkg/pdata`: avoid allocations in WriteInt64 and WriteUint64 (#15629)

##### 🧰 Bug fixes 🧰

- `cmd/schemagen`: Accept components written without a configuration body in the generated Collector configuration schema (#15728)
- `pkg/confmap`: Fix bug where an escaped URI appearing before a valid URI prevented the subsequent URI from being expanded. (#15867)
  URI scanning now continues after an escaped URI while preserving the escaped expression as literal text.
- `pkg/featuregate`: Reject feature gate IDs with an empty dot-separated segment (leading, trailing, or consecutive dots), e.g. `.foo`, `foo.`, `foo..bar`. (#15676)
- `pkg/pprofile`: Stop erasing inline attribute keys when key_strindex is unset, and clear key_strindex once it is resolved. (#15793)
- `pkg/pprofile`: Reference resource and scope attribute strings via the ProfilesDictionary string table when marshaling and unmarshaling OTLP profiles export requests. (#15792)
- `pkg/scraperhelper`: Fix shutdown being delayed by extra scrapes when a scrape runs longer than the collection interval (#15736)
  If a scrape was still running when the next tick fired, the pending tick and the shutdown
  signal could both be ready when it finished and the controller chose between them at random.

#### API Changelog

##### 🛑 Breaking changes 🛑

- `cmd/mdatagen`: remove deprecated func DefaultMetricsBuilderConfig (#15854)
- `pkg/service`: Remove the deprecated `extensioncapabilities.ConfigWatcher` interface, `Extensions.NotifyConfig`, and `service.Settings.CollectorConf`. (#15399)
  These were deprecated in v0.155.0. Use `ConfigSnapshotWatcher`, `NotifyConfigSnapshot`, and
  `Settings.ConfigSnapshot` instead.
- `pkg/service`: Remove deprecated config option LoggingOptions (#15919)

##### 💡 Enhancements 💡

- `pkg/config/confignet`: Migrate network core types to schema-based configuration generated by mdatagen. (#15706)

##### 🧰 Bug fixes 🧰

- `pkg/configoptional`: Properly marshal and unmarshal `encoding.TextMarshaler`/`encoding.TextUnmarshaler` types (#15636)
- `pkg/featuregate`: Reject feature gate IDs with an empty dot-separated segment (leading, trailing, or consecutive dots), e.g. `.foo`, `foo.`, `foo..bar`. (#15676)

### Core v0.162.0 (2026-09-28)

Full notes: https://github.com/open-telemetry/opentelemetry-collector/releases/tag/v0.162.0

#### End-user changelog

##### 🛑 Breaking changes 🛑

- `cmd/mdatagen`: Generated processor lifecycle tests now assert that the processor propagates the incoming context unchanged to the next consumer by default. (#15994)
  Disable with `skip_context_propagation: true`
- `processor/queue_batch`: Rename `queuebatch` processor to `queue_batch` processor. (#14396)

##### 💡 Enhancements 💡

- `extension/memory_limiter`: Add otelcol_memorylimiter_refused_requests metric to record network request refusals in extension mode. (#15561)
- `pkg/confighttp`: Enable keepalive configuration by default. (#16026)
  Introduces the feature gate `pkg.confighttp.PrioritizeNewKeepalive`. When disabled, this flag
  restores the old behaviour of removing the keepalive configuration in favour
  of the deprecated fields `IdleConnTimeout`, `MaxIdleConns`, `MaxIdleConnsPerHost`,
  `DisableKeepAlives` when the flag is disabled.
- `pkg/exporterhelper`: Make the partition idle timeout configurable via `batch::partition::idle_timeout` and raise the default to 90s. (#15894)
- `pkg/exporterhelper`: Make the multi-batcher partition LRU cache size configurable and export cache size metrics. (#14526)
  Adds `sending_queue::batch::partition::cache_size` (default 10000) to cap the
  number of active partition batchers. The value
  must be positive. Current size and configured capacity are exported as
  `otelcol_exporter_queue_batch_partition_cache_size`
  and `otelcol_exporter_queue_batch_partition_cache_capacity`.
- `pkg/pprofile`: Speed up profiles dictionary merging during exporter-queue batching by replacing the linear-scan dedup in switchDictionary with an indexed lookup, reducing per-merge cost from O(N*L^2) to O(N+L). (#15544)
  No behavior change: merged dictionary contents and remapped indices are identical to before.
- `pkg/receiverhelper`: Stop allocating a span link that is always discarded when a long-lived-context receiver starts an operation without a parent span context. (#15998)
  Receivers created with `LongLivedCtx: true` no longer build a `trace.Link` when the
  long-lived context carries no valid span context. The SDK already discarded such a link,
  so behaviour is unchanged. This removes 3 of 7 allocations per receive operation.
- `pkg/xpdata`: Reduce the time `xhash.MapHash` takes for maps with many entries. (#15990)

##### 🧰 Bug fixes 🧰

- `exporter/debug`: Support known sync error handling on AIX (#15924)
  Enable the debug exporter to handle known synchronous errors on AIX.
- `pkg/exporterhelper`: Drop only the oversized item when splitting a batch, instead of discarding every item queued behind it (#15936)
  Applied to logs only for now
- `pkg/exporterhelper`: Add exporter and data_type attributes to exporter/enqueue spans. (#16022)
- `receiver/otlp`: Error handler preserves the HTTP status code when the request Content-Type is not one a Status can be encoded in (#15995)
  Extends the fix in #13414, which handled a missing Content-Type. A Content-Type that was
  present but unsupported, or malformed, still fell through to
  `500 {"code": 13, "message": "failed to marshal error message"}`, reporting client errors
  such as 401 from a server auth extension or 400 from an unsupported Content-Encoding as
  server faults.

#### v1.67.0/v0.161.0

##### 🛑 Breaking changes 🛑

- `pkg/pprofile`: Remove deprecated AggregationTemporality, Duration, SetDuration (#15855)
- `pkg/scraperhelper/controller`: Remove deprecated AddScraper func (#15934)
- `pkg/service`: Remove deprecated ZapOptions (#15935)
- `pkg/xconfmap`: Remove deprecated WithForceUnmarshaler func (#15932)

##### 💡 Enhancements 💡

- `pkg/pdata`: avoid allocations in WriteInt64 and WriteUint64 (#15629)

##### 🧰 Bug fixes 🧰

- `cmd/schemagen`: Accept components written without a configuration body in the generated Collector configuration schema (#15728)
- `pkg/confmap`: Fix bug where an escaped URI appearing before a valid URI prevented the subsequent URI from being expanded. (#15867)
  URI scanning now continues after an escaped URI while preserving the escaped expression as literal text.
- `pkg/featuregate`: Reject feature gate IDs with an empty dot-separated segment (leading, trailing, or consecutive dots), e.g. `.foo`, `foo.`, `foo..bar`. (#15676)
- `pkg/pprofile`: Stop erasing inline attribute keys when key_strindex is unset, and clear key_strindex once it is resolved. (#15793)
- `pkg/pprofile`: Reference resource and scope attribute strings via the ProfilesDictionary string table when marshaling and unmarshaling OTLP profiles export requests. (#15792)
- `pkg/scraperhelper`: Fix shutdown being delayed by extra scrapes when a scrape runs longer than the collection interval (#15736)
  If a scrape was still running when the next tick fired, the pending tick and the shutdown
  signal could both be ready when it finished and the controller chose between them at random.

#### API changelog

##### 💡 Enhancements 💡

- `cmd/mdatagen`: Allow config metadata authors to choose `configoptional.Some` or `configoptional.Default` for generated optional fields (#15977)
  Set `go_struct.optional_mode: default` to generate an optional object configuration
  section with a fallback default while keeping it absent until configured. Omitting
  `optional_mode` preserves the existing `configoptional.Some` behavior.
- `pkg/config/configgrpc`: Migrate core types of common settings for a gRPC client to schema-based configuration generated by mdatagen. (#15967)
- `pkg/exporterhelper`: Add `NewDefaultBatchConfig` to build a `BatchConfig` with default values, including the partition `cache_size` and `idle_timeout` defaults. (#14526, #15894)
- `pkg/exporterhelper`: Make the partition idle timeout configurable via `batch::partition::idle_timeout` and raise the default to 90s. (#15894)
- `pkg/exporterhelper`: Make the multi-batcher partition LRU cache size configurable and export cache size metrics. (#14526)
  Adds `sending_queue::batch::partition::cache_size` (default 10000) to cap the
  number of active partition batchers. The value
  must be positive. Current size and configured capacity are exported as
  `otelcol_exporter_queue_batch_partition_cache_size`
  and `otelcol_exporter_queue_batch_partition_cache_capacity`.
- `pkg/xpdata`: Move pdata hash APIs from the contrib repo (#15914)

##### 🧰 Bug fixes 🧰

- `cmd/schemagen`: Fix `RefResolver` mutating shared, cached type definitions with per-occurrence annotations, which caused generated schemas to have incorrect (and run-to-run nondeterministic) `description`/`x-optional`/`x-pointer` values whenever multiple fields referenced the same type. (#15984)
- `pkg/pdata`: Fix `pcommon.Value.CopyTo` to deep-copy `ValueTypeBytes` values instead of sharing the backing array (#15621)
  The bytes oneof field in CopyAnyValue was assigned directly, so the copy and source shared the same []byte.
  This also affected Map.CopyTo and Slice.CopyTo, which delegate to CopyAnyValue.

### Core v0.163.0 (2026-10-14)

Full notes: https://github.com/open-telemetry/opentelemetry-collector/releases/tag/v0.163.0

#### End User Changelog

##### 💡 Enhancements 💡

- `cmd/builder`: Add `dist.resource.detection.detectors` to the builder config, letting distributions opt into a smaller set of resourcedetectionprocessor detectors via generated go build tags. (#16075)
- `cmd/mdatagen`: Generate exporter queue/batch sender defaults from an opt-in `sending_queue` field in metadata.yaml. See the [batching migration RFC](https://github.com/open-telemetry/opentelemetry-collector/blob/main/docs/rfcs/batching-migration.md). (#15963)
  Declaring `sending_queue` is opt-in; an exporter that omits it is unaffected until it explicitly opts in one at a time during Phase 2 of the migration. Set MDATAGEN_SENDING_QUEUE_OPT_OUT=true to generate the standard default for every undeclared exporter while auditing a whole repository.
- `pkg/pprofile`: Implement Profiles development-version metadata in the OTLP receiver and exporters. (#16147, #16009)
  The receiver rejects malformed, repeated, or unsupported versions before decoding.
  OTLP exporters send the version associated with their compiled-in Profiles schema.
  The version is not configurable, and existing clients without metadata identify
  the initial development version.

##### 🧰 Bug fixes 🧰

- `cmd/mdatagen`: Replace the O(n) scan in generated `recordDataPoint` with an O(1) hash lookup, fixing an O(n²) cost per scrape when many data points land on one resource. (#15912)
- `cmd/mdatagen`: When both migration gates are enabled, only the latest metric with its v1 attributes is emitted (legacy attributes are no longer included). (#15979)
- `pkg/exporterhelper`: Fix sending queue deadlocks when blocked offers are cancelled with block_on_overflow enabled. (#15700)
- `pkg/exporterhelper`: Drop only the oversized profile when splitting a profiles batch, instead of discarding every profile queued behind it (#16087)
  Same fix as
- `pkg/exporterhelper`: Drop only the oversized span when splitting a traces batch, instead of discarding every span queued behind it (#16087)
  Same fix as
- `pkg/pprofile`: Use the profiles dictionary for resource and scope attribute strings sent over OTLP/gRPC. (#15861)
  The OTLP/gRPC profiles client now interns attribute strings before transmission, matching the OTLP/HTTP path. The server resolves the references before exposing pdata to consumers.
- `pkg/xpdata`: Fix `xhash` producing the same hash for different maps by length-prefixing keys, strings and bytes. (#16048)
  All hash values produced by `xhash` change.

#### API Changelog

##### 💡 Enhancements 💡

- `pkg/component`: Document compatibility guidelines for adding fields to public structs in the component interface RFC. (#16069)
- `pkg/pprofile`: Implement Profiles development-version metadata in the OTLP receiver and exporters. (#16147, #16009)
  The receiver rejects malformed, repeated, or unsupported versions before decoding.
  OTLP exporters send the version associated with their compiled-in Profiles schema.
  The version is not configurable, and existing clients without metadata identify
  the initial development version.

##### 🧰 Bug fixes 🧰

- `pkg/otelcol`: Redact config opaque MapList values in unexpanded configuration snapshots (#15980)

### Core v0.164.0 (2026-10-26)

Full notes: https://github.com/open-telemetry/opentelemetry-collector/releases/tag/v0.164.0

#### End User Changelog

##### 💡 Enhancements 💡

- `cmd/mdatagen`: Add support for supported_platforms in component metadata, allowing generated component tests to target explicitly supported platforms (#13319)

##### 🧰 Bug fixes 🧰

- `cmd/mdatagen`: Fix the generated `dataPointKey` function triggering gosec G115 (`uint64` to `int64` conversion) in components that use mdatagen. (#16176)
  The generated hash values are unchanged.
- `exporter/otlp_http`: Report the URL the request was actually sent to in HTTP status error messages when a middleware rewrites the request URL. (#14673)
  Middleware RoundTrippers that clone the request before rewriting its URL left
  the configured placeholder URL in 4xx/5xx error messages. The exporter now
  reads the destination from the response instead.
- `pkg/otelcol`: Redact non-empty literal defaults in unexpanded env provider references such as `${env:NAME:-literal}` in the raw config reported by the OpAMP extension when `reports_raw_config` is enabled (#16141)
  Empty defaults such as `${env:NAME:-}` stay visible. Other provider schemes are unchanged.

#### API Changelog

##### 💡 Enhancements 💡

- `pkg/xpdata`: Add `xhash.WithUint64` to hash a `uint64` value without converting it to `int64`. (#16176)
  It produces the same hash as `xhash.WithValue(pcommon.NewValueInt(int64(v)))`.

##### 🧰 Bug fixes 🧰

- `pkg/exporterhelper`: Expose PartitionConfig and NewDefaultPartitionConfig so that users can modify it. (#16197)

### Core v0.165.0 (2026-11-06)

Full notes: https://github.com/open-telemetry/opentelemetry-collector/releases/tag/v0.165.0

#### End User Changelog

##### 🛑 Breaking changes 🛑

- `pkg/confighttp`: Remove deprecated fields `IdleConnTimeout`, `MaxIdleConns`, `MaxIdleConnsPerHost`, `DisableKeepAlives`. (#15973)

##### 🚀 New components 🚀

- `pkg/xreceiverhelper`: Add xreceiverhelper with an `ObsReport` that reports profile sample metrics per sample type. (#16251)
  `ObsReport.EndProfilesOpBySampleType` records the
  `otelcol_receiver_{accepted,refused,failed}_profile_samples` metrics with an additional
  `sample_type` attribute, formatted as "type:unit", as a single payload can hold multiple profiles
  with different sample types. Use `ProfileSampleCountsByType` to compute the sample counts before
  the profiles are passed to the next consumer, as the data may be mutated downstream.
  The OTLP receiver now uses `EndProfilesOpBySampleType`.

##### 💡 Enhancements 💡

- `pkg/configmiddleware`: allow to override the dialer used by confighttp.ToClient and configgrpc.ToClient (#16019)
- `pkg/featuregate`: Allow underscores in feature gate IDs. (#16243)
- `pkg/pdata`: Improve performance of pcommon.Map Get, Range, and All functions. (#16282, #16321)
- `pkg/pdata`: Reduce number of allocations when updating an oneof primitive (#16226)
- `pkg/service`: Service now supports configuring additional resource detectors for internal telemetry as per the update to otelconf v0.26.0. (#15869)
- `pkg/service`: Warn at startup when a pipeline combines the batch processor with exporterhelper batching. (#15965)
  Detection does not cross connectors or inspect exporter wrappers that hide exporterhelper's batching capability.
- `pkg/xprocessorhelper`: Instrument `xprocessorhelper.NewProfiles` with `otelcol_processor_incoming_items`, `otelcol_processor_outgoing_items`, and `otelcol_processor_internal_duration`, consistent with the other signal constructors. (#15523)
- `processor/memory_limiter`: Add `garbage_collector` config section to allow disabling forced garbage collection via `enabled` field. (#15081)
- `processor/queue_batch`: Promote the queue_batch processor to beta for traces, metrics, and logs, and to alpha for profiles. (#12022)
- `processor/queue_batch`: Report queue and batch metrics as processor metrics (#14038)

##### 🧰 Bug fixes 🧰

- `cmd/mdatagen`: Fix panic in `Attribute.TestValue()` and `Attribute.TestValueTwo()` when handling single-element or empty enum attributes. (#15644)
- `cmd/mdatagen`: Fix generated metrics tests failing when a metric migration's `through_gates` feature gates are promoted past alpha. (#16249)
  The generated tests now explicitly set the migration feature gates for each test case and restore
  their previous state on cleanup, instead of assuming the gates are disabled by default.
  When a gate's stage forbids the state a case needs, such as disabling a stable gate, the metrics-builder
  test skips only its gate-dependent count and warning assertions, and the per-combination versioned-metric
  sub-tests for that combination are skipped.
- `cmd/mdatagen`: Generate README configuration docs for `exported_configs` definitions. (#16164)
  Object definitions and scalar type aliases under `exported_configs` are now rendered in the README after the `config:` table.
  Packages that only declare `exported_configs` can now get generated docs once their README contains the config markers.
  Components that only declare `exported_configs` no longer get an empty configuration table.
- `cmd/schemagen`: Handle file-not-found errors when loading schemas (#15925)
- `pkg/configgrpc`: Bound the zstd decoder window by the configured maximum receive message size instead of the library default. (#16280)
  A zstd frame declares its window in the header and the decoder allocated it
  before producing any output, so a small crafted message could drive a large
  allocation regardless of `max_recv_msg_size_mib`. The decoder is also
  returned to its pool as soon as gRPC is done with a message.
- `pkg/confighttp`: Bound the zstd decoder window by `max_request_body_size` instead of the library default. (#16280)
  A zstd frame declares its window in the header and the decoder allocated it
  before producing any output, so a small crafted body could drive a large
  allocation regardless of the configured request body size.
- `pkg/confighttp`: Accept Content-Encoding: identity as equivalent to no encoding. (#15122)
- `pkg/exporterhelper`: Fix a `Cannot unref freed data` panic when a persistent sending queue forwards requests into another pipeline (#15256)
- `pkg/exporterhelper`: With `wait_for_result`, canceling a request that the sending queue already accepted no longer returns early (#16255)
  Previously a canceled context made it return `context.Canceled` while the request was still
  delivered, so callers could report a failure for data that had been sent. Canceling still takes
  effect while nothing has been done with the request.
- `pkg/pdata`: Add recursion depth limit (100) to proto unmarshalling of AnyValue, ArrayValue, KeyValueList, and KeyValue to prevent stack overflow from maliciously crafted deeply nested payloads. (#15301)
- `pkg/service`: Skip graph nodes that have not been built during shutdown to prevent a panic when a partial receiver reload fails to build a receiver. (#16261)

#### API Changelog

##### 🚩 Deprecations 🚩

- `pkg/componentstatus`: Deprecate componentstatus.Watcher in favour of extensioncapabilities.ComponentStatusWatcher (#16304)

##### 🚀 New components 🚀

- `pkg/xreceiverhelper`: Add xreceiverhelper with an `ObsReport` that reports profile sample metrics per sample type. (#16251)
  `ObsReport.EndProfilesOpBySampleType` records the
  `otelcol_receiver_{accepted,refused,failed}_profile_samples` metrics with an additional
  `sample_type` attribute, formatted as "type:unit", as a single payload can hold multiple profiles
  with different sample types. Use `ProfileSampleCountsByType` to compute the sample counts before
  the profiles are passed to the next consumer, as the data may be mutated downstream.
  The OTLP receiver now uses `EndProfilesOpBySampleType`.

##### 💡 Enhancements 💡

- `pkg/confighttp`: Mark confighttp as stable (#9380)
- `receiver/otlp`: Migrate the OTLP receiver configuration to metadata.yaml and generate its config schema from the metadata. (#16212)

## Contrib changelog (opentelemetry-collector-contrib), components we ship

Filtered to `all`, `exporter/clickhouse`, `processor/filter`, `processor/delta_to_cumulative`, `processor/resource`, `processor/attributes`, `extension/bearertokenauth`, the health check and file storage extensions, `pkg/ottl` (used by the filter processor), and `receiver/pprof` and `pkg/translator/pprof` (candidates for ingesting pprof). Follow the links for every other component.

### Contrib v0.161.0 (2026-09-14)

Full notes: https://github.com/open-telemetry/opentelemetry-collector-contrib/releases/tag/v0.161.0

#### End User Changelog

##### 🛑 Breaking changes 🛑

- `all`: Remove the deprecated mezmo exporter. (#49953)
  Use the OTLP/HTTP exporter to send logs directly to Mezmo instead. See
  https://docs.mezmo.com/telemetry-pipelines/otel-collector and
  https://docs.mezmo.com/telemetry-pipelines/open-telemetry-source for migration guidance.
- `pkg/ottl`: Promote the `ottl.PanicDuplicateName` feature gate to stable. (#50873)
- `pkg/ottl`: Remove the deprecated `Base64Decode` converter. Use the `Decode` converter with the `base64` encoding instead. (#50875)
- `pkg/ottl`: Promote the `ottl.set.allowNil` feature gate to beta, enabling it by default. (#49741)
  When enabled, the `set` function passes `nil` values directly to the target instead of treating them as a no-op.

##### 💡 Enhancements 💡

- `internal/healthcheck`: Migrate to NotifyConfigSnapshot (#50924)
- `pkg/ottl`: Promote the `ottl.contexts.enableOTelColContext` feature gate to stable. (#46437)
  The `otelcol` context is now always available and the feature gate can no longer be disabled.
- `pkg/ottl`: Allow `Concat` to accept slice values produced by paths and converter expressions. (#27821, #38690)

##### 🧰 Bug fixes 🧰

- `all`: Do not panic on AIX (#50764)
  These components do not work on AIX. However, they panic if incorporated in a distribution running on AIX, even if not used.
  The fix is to return an error instead of a panic when trying to run on this OS.
  The components affected are:
  - connector/datadogconnector
  - exporter/datadogexporter
  - exporter/pulsarexporter
  - extension/datadogextension
  - extension/tailstorage/pebbletailstorageextension
  - receiver/pulsarreceiver

#### API Changelog

##### 🛑 Breaking changes 🛑

- `pkg/ottl`: Change `ConcatArguments.Vals` to use `ottl.SliceGetter`. (#27821, #38690)
- `pkg/ottl`: Remove the deprecated `Base64Decode` converter. Use the `Decode` converter with the `base64` encoding instead. (#50875)
- `pkg/ottl`: Rename `NewTransformContextPtr` to `NewTransformContext` in all OTTL contexts. (#50869)
- `processor/filter`: Removing deprecated funcs (#50898)
  Remove the deprecated *FunctionsNew aliases (WithResourceFunctionsNew, WithDataPointFunctionsNew, WithLogFunctionsNew,
  WithMetricFunctionsNew, WithSpanEventFunctionsNew, WithSpanFunctionsNew, WithProfileFunctionsNew, DefaultLogFunctionsNew,
  DefaultMetricFunctionsNew, DefaultDataPointFunctionsNew, DefaultSpanFunctionsNew, DefaultSpanEventFunctionsNew,
  DefaultProfileFunctionsNew) in favour of their non-New equivalents, deprecated since v0.152.0.

##### 💡 Enhancements 💡

- `pkg/ottl`: Export the `SchemaURLItem` interface so it can be named by callers of the exported context API. (#50901)

### Contrib v0.162.0 (2026-09-28)

Full notes: https://github.com/open-telemetry/opentelemetry-collector-contrib/releases/tag/v0.162.0

#### End User Changelog

##### 🛑 Breaking changes 🛑

- `all`: Remove the wavefront receiver after a period of deprecation (#51397)
- `pkg/ottl`: Remove the stable `ottl.PanicDuplicateName` and `ottl.contexts.enableOTelColContext` feature gates. (#44630, #46437)

##### 💡 Enhancements 💡

- `extension/health_check`: Enable keepalive by default (#51175)
- `pkg/ottl`: Promote the `ottl.set.allowNil` feature gate to stable. (#49741)

##### 🧰 Bug fixes 🧰

- `all`: Exclude datadogconnector, datadogexporter, and datadogextension on solaris (#51329)
- `pkg/ottl`: Reject lambda expressions at parse time when they are not passed to a function argument that accepts them. (#51560)
- `processor/delta_to_cumulative`: Fix exponential histogram downscaling exceeding the bucket limit due to incorrect index rounding. (#50923)

#### API Changelog

##### 🛑 Breaking changes 🛑

- `all`: Remove the `pkg/pdatautil` module. Its hash helpers moved to `go.opentelemetry.io/collector/pdata/xpdata/xhash` in opentelemetry-collector. (#51108)
  Replace imports of `github.com/open-telemetry/opentelemetry-collector-contrib/pkg/pdatautil`
  (`Hash`, `Hash64`, `MapHash`, `ValueHash`, and the `With*` options) with
  `go.opentelemetry.io/collector/pdata/xpdata/xhash`.
- `pkg/ottl`: Unexport the implementations of the standard OTTL functions (#50927)
- `pkg/ottl`: Move profiles support into a separate `pkg/ottl/contexts/xprofile` module so it is excluded from OTTL's stability guarantees. (#50906)
  The `ottlprofile` and `ottlprofilesample` contexts moved to
  `github.com/open-telemetry/opentelemetry-collector-contrib/pkg/ottl/contexts/xprofile`,
  and the `ProfileID` converter and `NewProfileIDFactory` moved from `ottlfuncs` into that
  module's `ottlfuncs` package. `ProfileID` is no longer part of `StandardFuncs` and
  `StandardConverters`. Importers must update their import paths, depend on the new module,
  and merge the profiles converters (for example via
  `xprofilefuncs.WithProfileConverters`) to keep `ProfileID` available.
- `pkg/ottl`: Remove the unused `Strp`, `Floatp`, `Intp`, and `Boolp` helpers from the `ottltest` package. (#51037)
- `pkg/ottl`: Move the experimental lambda converters into the `pkg/ottl/xottl` module so they are excluded from OTTL's stability guarantees. (#51563)
  The `All`, `Any`, `Filter`, `Find`, `MapEach`, `MapKeys`, `Reduce`, and `When` converters and their `New*Factory`
  functions moved to `github.com/open-telemetry/opentelemetry-collector-contrib/pkg/ottl/xottl/ottlfuncs`. They are no
  longer part of `StandardFuncs` and `StandardConverters`; merge them (for example via
  `xottlfuncs.WithExperimentalConverters`) to keep them available.
- `pkg/ottl`: Unexport the `ParserCollection` `Settings` and `ErrorMode` fields in favor of read-only `Settings()` and `ErrorMode()` accessor methods (#51156)
- `pkg/ottl`: `SliceGetter.Range` now returns (bool, error); the boolean reports whether the underlying slice is non-nil. (#51494)
- `pkg/ottl`: Remove the `ottltest` package and its `SetFeatureGateForTest` function from the public API. (#47305)
- `pkg/ottl`: Remove the stable `ottl.PanicDuplicateName` and `ottl.contexts.enableOTelColContext` feature gates. (#44630, #46437)
- `pkg/ottl`: Unexport the argument structs of the standard OTTL functions (#51023)

##### 🚀 New components 🚀

- `pkg/ottl/xottl`: Add the `pkg/ottl/xottl` module to hold OTTL's experimental Go API outside of OTTL's stability guarantees. (#51561)

##### 💡 Enhancements 💡

- `pkg/ottl`: Add `Experimental()` to the `Factory` interface and a `WithExperimental` option so functions can declare whether they are covered by stability guarantees. (#50927)

##### 🧰 Bug fixes 🧰

- `pkg/ottl`: Fix `SliceGetter.Get` and literal slice folding so a coerced typed-nil slice (for example `[]string(nil)` when elements are getters) is treated as nil instead of an empty non-nil slice. (#51494)
- `pkg/ottl`: Fix `GetLiteralValues` and `GetScalarLiteralValues` so they do not evaluate dynamic slices when checking for literal values. (#51438)
- `pkg/ottl`: Prevent `SliceGetter.Get` and `SliceGetter.Range` from panicking when constructed from `nil`. (#51174)

### Contrib v0.163.0 (2026-10-14)

Full notes: https://github.com/open-telemetry/opentelemetry-collector-contrib/releases/tag/v0.163.0

#### End User Changelog

##### 💡 Enhancements 💡

- `exporter/clickhouse`: Add `database_engine` config to set the `ENGINE` used when creating the database, such as `Replicated`. (#51513)
  When `database_engine.name` is `Replicated`, `ON CLUSTER` is only applied to the `CREATE DATABASE` statement.
- `pkg/ottl`: Add the `pkg.ottl.functions.enableExperimental` feature gate, which must be enabled to use experimental OTTL functions. (#51564)
- `pkg/ottl`: Allow `keep_keys` to accept slice values from paths and converter expressions when the `pkg.ottl.functions.enableDynamicSliceArguments` feature gate is enabled. (#45980)
- `pkg/ottl`: Improve OTTL parse error diagnostics by reporting the line and column of the input where available. (#51680)
  Not all parse errors carry a position: errors that aggregate multiple statements, and some
  inner errors that didn't already carry one, are still returned without one. The exact
  wording and position of statement, condition, and value expression parse error messages
  has changed as a result. The position is exposed programmatically via the new experimental
  `xottl.Error` type.
- `pkg/ottl`: Add the beta `pkg.ottl.functions.enableDynamicSliceArguments` feature gate, which controls whether slice arguments of stable functions such as `Concat` accept paths and converters. (#51565)

##### 🧰 Bug fixes 🧰

- `pkg/ottl`: `Time` no longer treats a trailing strptime `%Z` as Zulu (UTC) when no location is given (#51416)
- `pkg/ottl`: Reject literal values that are not lists for slice arguments, such as `keep_keys(attributes, "http.method")` or `Concat("a", "-")`, at parse time instead of failing on every execution (#51833)

#### API Changelog

##### 🛑 Breaking changes 🛑

- `pkg/ottl`: `FunctionContext` and the `Standard*Getter` structs can no longer be initialized with unkeyed struct literals. (#47305)
- `pkg/ottl`: Move the experimental lambda expression Go API into the `pkg/ottl/xottl` module so it is excluded from OTTL's stability guarantees. (#51566)
  `LambdaExpression`, `LambdaActivation`, and `NewTestingLambdaExpression` moved to
  `github.com/open-telemetry/opentelemetry-collector-contrib/pkg/ottl/xottl`. `LocalIdentifierDecl` and
  `LambdaExpression.Formals` were removed.
- `pkg/ottl`: Move the experimental `SliceGetter` API to the `xottl` module. (#51565)
  `ottl.SliceGetter`, `ottl.GetLiteralValues`, `ottl.GetScalarLiteralValues`, and `ottl.NewTestingSliceGetter` are now in `xottl`.

##### 💡 Enhancements 💡

- `pkg/ottl`: Improve OTTL parse error diagnostics by reporting the line and column of the input where available. (#51680)
  Not all parse errors carry a position: errors that aggregate multiple statements, and some
  inner errors that didn't already carry one, are still returned without one. The exact
  wording and position of statement, condition, and value expression parse error messages
  has changed as a result. The position is exposed programmatically via the new experimental
  `xottl.Error` type.
- `pkg/ottl`: Add `WithCache` option to the `ottlotelcol` `TransformContext`. (#51652)

##### 🧰 Bug fixes 🧰

- `pkg/ottl`: Preserve the distinction between nil and empty slices in the `xottl` `GetScalarLiteralValues` and `GetLiteralValues` helpers. (#51814)

### Contrib v0.164.0 (2026-10-26)

Full notes: https://github.com/open-telemetry/opentelemetry-collector-contrib/releases/tag/v0.164.0

#### End User Changelog

##### 🛑 Breaking changes 🛑

- `pkg/ottl`: Remove the stable `ottl.set.allowNil` feature gate. (#48714)
- `pkg/translator/pprof`: Return an error instead of panicking when profiling data contains invalid profile references. (#51908)
- `processor/filter`: remove stable processor.filter.defaultErrorModeIgnore gate (#52238)

##### 💡 Enhancements 💡

- `exporter/clickhouse`: Added a Bloom Filter data skipping index (idx_event_name) to the EventName column with a 0.01 false positive rate and granularity 1. (#49310)
- `pkg/ottl`: Promote traces, metrics, and logs signals from beta to stable. (#51068, #47305)

##### 🧰 Bug fixes 🧰

- `pkg/ottl`: Fix context inference for statements that pass an all-uppercase converter name, such as `SHA256`, as a function argument. (#52192)
- `receiver/pprof`: Fix the HTTP scraper to return an error for non-2xx responses, close the response body, and honor the scrape context. (#52256)

#### API Changelog

##### 🛑 Breaking changes 🛑

- `pkg/ottl`: Remove the stable `ottl.set.allowNil` feature gate. (#48714)

### Contrib v0.164.1 (2026-10-26)

Full notes: https://github.com/open-telemetry/opentelemetry-collector-contrib/releases/tag/v0.164.1

#### End User Changelog

##### 🧰 Bug fixes 🧰

- `all`: Fix modules requiring the nonexistent v1.2.0 of `pkg/ottl` and `processor/k8sattributesprocessor`. (#52356)

### Contrib v0.165.0 (2026-11-07)

Full notes: https://github.com/open-telemetry/opentelemetry-collector-contrib/releases/tag/v0.165.0

#### End User Changelog

##### 🛑 Breaking changes 🛑

- `all`: Remove the deprecated SignalFx receiver. Use the OTLP receiver instead. (#51934)

##### 💡 Enhancements 💡

- `exporter/clickhouse`: Size the ClickHouse client connection pool from `sending_queue.num_consumers` by default. (#52350)
  The metrics exporter uses one connection per metric type per consumer.
  `max_open_conns` and `max_idle_conns` set in `endpoint` or `connection_params` still take precedence.
- `exporter/clickhouse`: Change the default column codec in the base table schemas from `ZSTD(1)` to `ZSTD(3)`. (#52705)
  Only applies to newly created tables, existing tables are not altered.
- `extension/bearertokenauth`: Expose the configured token as an OAuth2 token so the extension can be used as a token source (#50574)
  This allows `bearertokenauth` to be referenced as the `oauthbearer_token_source` of the Kafka
  exporter and receiver, so a SASL/OAUTHBEARER token can be read from a file that is populated
  out of band, such as a Kubernetes projected service account token.
- `pkg/ottl`: Use substring matching for literal-only patterns in IsMatch, delete_matching_keys, keep_matching_keys, replace_pattern and replace_all_patterns without changing regex semantics. (#52593)
- `pkg/ottl`: Allow converters and paths as keys in map literals, e.g. `{ToUpperCase("key"): "value"}`. (#52210)
  Enable the `pkg.ottl.enableDynamicMapKeys` feature gate to use this feature.
- `pkg/ottl`: Improve StandardStringLikeGetter performance by adding direct string conversion for int64 and bool values, avoiding unnecessary JSON marshaling. (#52596)
- `pkg/ottl/contexts/xspanlink`: Add `ottlspanlink` context, in the new experimental `xspanlink` module, exposing per-span-link fields (`trace_id`, `span_id`, `trace_state`, `attributes`, `dropped_attributes_count`, `flags`) for use in OTTL statements. (#26660)
- `pkg/ottl/xottl`: Add the experimental `ToValidUTF8` converter to replace invalid UTF-8 byte sequences in a string with a replacement string (#51717)

##### 🧰 Bug fixes 🧰

- `pkg/ottl`: Make the `MD5`, `SHA1` and `CommunityID` converters work when the collector runs in strict FIPS 140-3 mode (`GODEBUG=fips140=only`). (#52479)
  These converters hash telemetry data for non-security purposes. The digest is now computed with
  `crypto/fips140.WithoutEnforcement`, so a collector built with the Go FIPS 140-3 module and run with
  `GODEBUG=fips140=only` no longer fails or panics when a statement uses them. The algorithms themselves
  are still not FIPS approved and must not be used for any security function.

#### API Changelog

##### 🛑 Breaking changes 🛑

- `all`: Remove the deprecated SignalFx receiver. Use the OTLP receiver instead. (#51934)

##### 💡 Enhancements 💡

- `pkg/ottl/contexts/xspanlink`: Add `ottlspanlink` context, in the new experimental `xspanlink` module, exposing per-span-link fields (`trace_id`, `span_id`, `trace_state`, `attributes`, `dropped_attributes_count`, `flags`) for use in OTTL statements. (#26660)

### Contrib v0.165.1 (2026-11-09)

Full notes: https://github.com/open-telemetry/opentelemetry-collector-contrib/releases/tag/v0.165.1

No entries for the components we ship.
