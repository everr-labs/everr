# Collector `/tmp` directory

The collector needs a writable `/tmp` for transient files created during webhook payload processing. These files are short-lived and cleaned up by the collector after use.

## Why Alpine instead of scratch

The original `FROM scratch` final stage has no filesystem at all. Creating `/tmp` in a scratch image requires copying a directory from a build stage, but Docker's `COPY --chmod` does not reliably apply permissions to the destination directory itself — only to its contents. This results in a root-owned `/tmp` that the non-root collector process (UID 10001) cannot write to.

Switching to `FROM alpine:3.22` adds ~7MB but provides a properly configured `/tmp` with standard `1777` permissions out of the box.

## Current behavior

Temp files are written to the container's **writable layer** (copy-on-write storage on the host's disk). This is ephemeral — the writable layer is discarded whenever the container is recreated (redeploy, restart). Since the collector only writes small, short-lived files, there is no disk growth risk in practice.

## Optimal: tmpfs mount

For environments where disk writes for temp data are undesirable (security policy, disk-constrained hosts)

```yaml
tmpfs:
  - /tmp:size=128M
```

This stores temp files in RAM, auto-cleans on container stop, and caps usage at 128MB. The tmpfs mount overrides the directory from the image, so no Dockerfile changes are needed.
