# Upstream

Source repository: `open-telemetry/opentelemetry-collector-contrib`
Source package: `exporter/clickhouseexporter`
Source tag: `v0.160.0`

This package started as a copy of upstream ClickHouse exporter `v0.152.0` and was
brought up to `v0.160.0`, the version `collector/config/manifest.yaml` pins for the
cloud collector. Keep the two in step: the local store and the cloud read model
share the explorer queries, so a schema that drifts here shows up as a query that
works in one place and not the other.

Local changes are tracked in `EVERR_CHANGES.md`.
