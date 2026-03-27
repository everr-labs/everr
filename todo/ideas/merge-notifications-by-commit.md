# Merge Notifications by Commit

## What
Merge multiple notifications triggered by the same commit into a single commit-level notification instead of showing one notification per failing run or job.

## Why
Reduces notification spam when a single commit causes several related failures, making the signal easier to scan and less disruptive for developers.

## Who
Developers receiving Everr notifications about CI failures on their commits.

## Rough appetite
unknown

## Notes
Group notifications by repository and commit SHA. Consider updating the existing notification as more failures arrive for the same commit instead of creating a new one each time.
