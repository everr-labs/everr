# @everr/app

## 0.11.0

### Patch Changes

- 33fe03c: Self-hosted Everr is now published to the GitHub Container Registry as `ghcr.io/everr-labs/everr-app` and `ghcr.io/everr-labs/everr-collector`. ClickHouse runs the stock `clickhouse/clickhouse-server` image, and the app applies its schema on startup. The Compose bundle in `deploy/` pulls these images, pinned to the release. Everr's CLI, libraries, and apps now share one version.
- Updated dependencies [38a0459]
  - @everr/otel-web@0.11.0
  - @everr/otel-errors@0.11.0
  - @everr/tanstack-start-otel@0.11.0
