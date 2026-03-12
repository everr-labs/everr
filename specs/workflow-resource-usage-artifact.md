# Workflow Resource Usage Artifact v2

## Workflow usage

- Each instrumented job adds one step after checkout:

```yaml
- name: Collect resource usage
  uses: ./.github/actions/everr-resource-usage
```

- The action starts sampling in `main` and finalizes plus uploads in `post`.
- The action discovers the current job check run id through the GitHub Actions jobs API using the default `github.token`.
- Sampling is best-effort and Linux-only.
- Sampling uses a fixed `5` second interval.
- The workflow token needs `actions: read` and `contents: read`.

## Artifact contract

- Artifact name pattern: `everr-resource-usage-v2-<checkRunId>`
- One artifact is uploaded per job.
- Artifact root files:
  - `metadata.json`
  - `samples.ndjson`

## `metadata.json`

```json
{
  "schemaVersion": 2,
  "checkRunId": 12345678901,
  "repo": "everr-labs/everr",
  "runId": 1234567890,
  "runAttempt": 1,
  "githubJob": "lint",
  "startedAt": "2026-03-10T10:00:00.000Z",
  "completedAt": "2026-03-10T10:01:00.000Z",
  "runner": {
    "name": "GitHub Actions 1",
    "os": "Linux",
    "arch": "X64"
  },
  "filesystem": {
    "device": "/dev/root",
    "mountpoint": "/",
    "type": "ext4"
  }
}
```

## `samples.ndjson`

- One JSON document per line
- Required fields:
  - `timestamp`
  - `cpu.logical[]`
  - `memory.limitBytes`
  - `memory.usedBytes`
  - `memory.availableBytes`
  - `memory.utilization`
  - `filesystem.device`
  - `filesystem.mountpoint`
  - `filesystem.type`
  - `filesystem.limitBytes`
  - `filesystem.usedBytes`
  - `filesystem.freeBytes`
  - `filesystem.utilization`
  - `network.interfaces[]`

Example line:

```json
{"timestamp":"2026-03-10T10:00:05Z","cpu":{"logical":[{"logicalNumber":0,"utilization":0.12},{"logicalNumber":1,"utilization":0.18}]},"memory":{"limitBytes":17179869184,"usedBytes":3221225472,"availableBytes":13958643712,"utilization":0.1875},"filesystem":{"device":"/dev/root","mountpoint":"/","type":"ext4","limitBytes":53687091200,"usedBytes":21474836480,"freeBytes":32212254720,"utilization":0.4},"network":{"interfaces":[{"name":"eth0","receiveBytes":1234567,"transmitBytes":2345678}]}}
```
