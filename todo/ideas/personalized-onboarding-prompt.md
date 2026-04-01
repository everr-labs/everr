# Personalized prompt at the end of the onboarding flow

## What
At the end of the onboarding flow, show a personalized prompt tailored to what Everr has learned about the user's repo — e.g. a suggested next action based on their slowest job, a flaky test, or their notification setup.

## Why
New users install Everr but don't always know what to do next. A personalized nudge at the end of onboarding turns "I finished setup" into "I know exactly what to do next", reducing drop-off and building habit.

## Who
New Everr users who just completed the initial repo setup.

## Rough appetite
big

## Notes
The prompt should be generated from real data already collected during onboarding (pipeline runs, test results, job durations). Could be CLI output, web UI, or both.
