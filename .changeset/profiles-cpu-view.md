---
"@everr/app": patch
---

Profiles are easier to read:

- CPU flame graphs hide `(idle)` by default. It holds the CPU from samples taken while the JavaScript thread was idle: short tasks and event loop work that finished between samples, which no stack explains. Turn on "Include idle" in the filters to see it.
- Hovering the runtime frames `Non JS threads activity`, `Garbage Collection` and `(idle)` explains what they measure, including why CPU time can exceed wall time.
- Frames from the app's own server code now resolve to their TypeScript files, so their source links work.
