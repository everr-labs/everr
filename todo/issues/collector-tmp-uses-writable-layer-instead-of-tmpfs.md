# Collector `/tmp` writes to container writable layer instead of tmpfs

## What
The collector writes temp files to the container's copy-on-write writable layer instead of a tmpfs mount.

## Where
Collector container configuration (Dockerfile / compose/k8s deployment manifests).

## Steps to reproduce
N/A

## Expected
Temp files under `/tmp` are stored in RAM via a tmpfs mount (`/tmp:size=128M`), auto-cleaned on container stop, and never touch disk.

## Actual
Temp files land on the host's disk via the container writable layer. The layer is discarded on container recreation, but writes still go to disk unnecessarily.

## Priority
low

## Notes
Adding `tmpfs: - /tmp:size=128M` to the deployment config is the recommended fix. No Dockerfile changes needed — the tmpfs mount overrides the image's `/tmp` directory at runtime.
