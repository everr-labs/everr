# CI debug and optimize skills

## What
A set of Claude Code skills for debugging CI failures and optimizing CI performance, powered by the Everr CLI.

## Why
Everr already has rich CLI tooling for inspecting runs, logs, and test performance. Packaging that knowledge into skills would let AI assistants guide users through common CI workflows (diagnosing a failure, finding the slowest job, tracking flakiness) without needing to re-explain the tools each time.

## Who
Developers using Everr with Claude Code or other AI-assisted terminals.

## Rough appetite
medium

## Notes
- Could split into two skills: one for debugging (failure triage, log inspection) and one for optimization (slowest jobs/tests, caching opportunities).
- Would complement the existing `CLAUDE.md` Everr CLI quick-start guidance.
- Skills should lean on `everr status`, `everr show`, `everr logs`, `everr grep`, `everr slowest-tests`, `everr slowest-jobs`.
