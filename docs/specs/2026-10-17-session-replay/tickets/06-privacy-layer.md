# 06: Privacy layer

**What to build:** Clips never contain personal data by default. When the WebSDK `dev` option is not true, all text and inputs are Masked, `title`/`placeholder`/`aria-label` are Masked, media is Blocked, and file inputs are Ignored, all in the browser before events enter the buffer. Integrators tune it with Sentry-named options and `everr-*` markers.

**Blocked by:** 02

**Complexity:** high

**Verify:** `pnpm --filter @everr/otel-web test && pnpm --filter @everr/otel-web typecheck && pnpm --filter @everr/otel-web size`

**Status:** ready-for-agent

- [ ] Default bundle on when `dev` is not true, off when true; explicit options win in both cases
- [ ] Passwords always Masked (also with `maskAllInputs: false` and under `unmask`); file inputs always Ignored
- [ ] Media list Blocked (`img`, `svg`, `video`, `object`, `picture`, `embed`, `map`, `audio`, icon links), plus `base` and same-origin `srcdoc` iframes; Blocked elements keep their size
- [ ] Markers `everr-mask`/`everr-block`/`everr-ignore` and `data-everr-*`; selector options `mask`, `unmask`, `block`, `unblock`, `ignore`; `unmask` and `unblock` win
- [ ] `maskFn` replaces the asterisk substitution; `maskAttributes` rewrites attributes in full snapshots and attribute mutations via `emit`, no rrweb fork
- [ ] Same rules in Cookieless and Consented modes
- [ ] Tests assert on the Segment body for each rule under `dev` true and false
