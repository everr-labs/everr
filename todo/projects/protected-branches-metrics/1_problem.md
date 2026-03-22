# Problem Statement: Main Branches Metrics

## What's broken or missing?

Everr's success rate metrics aggregate across all branches. Feature branches, hotfix branches, and other short-lived refs are included in the same calculations as the branches that represent actual CI health. The result is a noisy signal that obscures regressions on the branches that matter.

## Who is affected?

Engineers and team leads tracking CI health over time — anyone trying to answer "is our success rate improving or degrading?" where mixing in feature branch runs gives a misleading picture.

## Concrete examples

1. A team's success rate drops. The drop is caused by a developer's experiment branch failing repeatedly, not a regression on main. The metric looks alarming but is irrelevant to the health of the main branch.
2. An org-wide success rate looks healthy, but main has been silently degrading — feature branch successes are masking it.

## Frequency vs. severity

Constant — every success rate view is affected as long as feature branches are active. Severity increases with team size and repo activity.

## What does success look like?

Users can designate one or more branches as "main branches." The test-overview page gains a toggle to filter data to main branches only. Repos get safe defaults out of the box — `main`, `master`, and `develop` are used when nothing is configured.
