# Main branches metrics

## What
Let users designate "main branches" so metrics (success rate, flakiness, slowest jobs/tests) focus on those instead of mixing in feature branch noise.

## Why
All-branch metrics are noisy. Feature branches skew averages and hide regressions on the branches that actually matter.

## Who
Engineers and team leads tracking CI health on long-lived branches.

## Rough appetite
medium

## Notes
- Use the name "main branches" — distinct from GitHub's push-protection concept of "protected branches".
- Default branch could be included automatically; others configured explicitly.
- Safe defaults out of the box: main, master, develop.
