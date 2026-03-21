# Protected Branches Metrics

## What
Let users mark certain branches (e.g. main, develop) so metrics focus on those instead of mixing in temporary ones.

## Why
All-branch metrics are noisy. Feature branches skew averages and hide regressions on the branches that actually matter.

## Who
Engineers and team leads tracking CI health on long-lived branches.

## Rough appetite
medium

## Notes
- Naming TBD: "protected", "baseline", "tracked", "watched" — different from GitHub's push-protection concept.
- Default branch could be included automatically; others configured explicitly.
- Slowest jobs/tests, flakiness, and success rate all benefit from this scope.
