# 24: Evaluation downsampling keeps exceptional points

**What to build:** The evaluation chart never omits the only point that
matters. Failed, breaching, and state-transition evaluations survive
downsampling.

**Details:** finding 13 in `../04-alerting-branch-review.md`.

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

- [ ] Exceptional points and state transitions are preserved before the display budget fills with representative samples
- [ ] A test with one exceptional point between sampled indexes
