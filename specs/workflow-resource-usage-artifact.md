# Workflow Resource Usage Artifact v1

## Canonical artifact

- Artifact name: `everr-resource-usage-v1`
- Produced by a final merge job after all instrumented jobs upload partial artifacts
- Root files:
  - `manifest.json`
  - `jobs/<checkRunId>/summary.json`
  - `jobs/<checkRunId>/samples.ndjson`

## Partial artifact contract

- Artifact name pattern: `everr-resource-usage-partial-<checkRunId>`
- Root files:
  - `summary.json`
  - `samples.ndjson`
- The final merge job copies each partial artifact into the canonical `jobs/<checkRunId>/...` layout and emits `manifest.json`

## `manifest.json`

```json
{
  "schemaVersion": 1,
  "repo": "everr-labs/everr",
  "runId": 1234567890,
  "runAttempt": 1,
  "sampleIntervalSeconds": 5,
  "generatedAt": "2026-03-10T10:00:30.000Z",
  "jobs": [
    {
      "checkRunId": 12345678901,
      "sampleCount": 12,
      "summaryPath": "jobs/12345678901/summary.json",
      "samplesPath": "jobs/12345678901/samples.ndjson"
    }
  ]
}
```

## `jobs/<checkRunId>/summary.json`

```json
{
  "schemaVersion": 1,
  "checkRunId": 12345678901,
  "repo": "everr-labs/everr",
  "runId": 1234567890,
  "runAttempt": 1,
  "githubJob": "lint",
  "sampleIntervalSeconds": 5,
  "startedAt": "2026-03-10T10:00:00.000Z",
  "completedAt": "2026-03-10T10:01:00.000Z",
  "runner": {
    "name": "GitHub Actions 1",
    "os": "Linux",
    "arch": "X64"
  },
  "sampleCount": 12,
  "durationMs": 60000,
  "cpu": {
    "avgPct": 21.4,
    "p95Pct": 58.2,
    "maxPct": 63.0
  },
  "memory": {
    "avgUsedBytes": 123456789,
    "maxUsedBytes": 234567890
  },
  "disk": {
    "peakUsedBytes": 345678901,
    "peakUtilizationPct": 42.1
  },
  "load1": {
    "max": 1.8
  }
}
```

## `jobs/<checkRunId>/samples.ndjson`

- One JSON document per line
- Required fields:
  - `timestamp`
  - `cpuUtilizationPct`
  - `memoryUsedBytes`
  - `memoryAvailableBytes`
  - `diskUsedBytes`
  - `diskAvailableBytes`
  - `diskUtilizationPct`
  - `load1`

Example line:

```json
{"timestamp":"2026-03-10T10:00:05Z","cpuUtilizationPct":12.5,"memoryUsedBytes":123456789,"memoryAvailableBytes":987654321,"diskUsedBytes":345678901,"diskAvailableBytes":1234567890,"diskUtilizationPct":21.9,"load1":0.42}
```
