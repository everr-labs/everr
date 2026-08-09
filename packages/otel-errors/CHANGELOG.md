# @everr/otel-errors

The entries below 0.1.0 belong to `@everr/auto-otel-errors`, this package's
former name, which is deprecated on npm. Its version line reached 0.2.3; 0.1.0
restarts numbering because the rename also dropped the browser and framework
entries and replaced `init()` with an OpenTelemetry instrumentation. There is
no in-place upgrade between the two lines.

## 0.2.3

### Patch Changes

- 28e8199: Retry release with NPM_TOKEN authentication.

## 0.2.2

### Patch Changes

- 6b94d92: Retry release with NPM_TOKEN authentication.

## 0.2.1

### Patch Changes

- 34d39ac: Fix npm package publishing to use trusted publishing.

## 0.2.0

### Minor Changes

- 34e86aa: Rename sensitive data configuration options from `scrubKeys` and `scrubPatterns` to `redactKeys` and `redactPatterns`, and preserve attributes when key-based redaction is disabled.
