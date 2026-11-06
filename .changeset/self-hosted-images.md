---
"@everr/app": patch
---

Self-hosted Everr is now published to the GitHub Container Registry as `ghcr.io/everr-labs/everr-app`, `ghcr.io/everr-labs/everr-collector`, and `ghcr.io/everr-labs/everr-clickhouse`. The Compose bundle in `deploy/` pulls these images, pinned to the release. Everr's CLI, libraries, and apps now share one version.
