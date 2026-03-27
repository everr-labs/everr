# Missing Direct Links to GitHub Actions and PRs

## What
There are no links from Everr's run detail/list views to the corresponding GitHub Action run page or associated PR, forcing users to manually search on GitHub.

## Where
Run detail page and runs list table (`packages/app/src/components/runs-list/`, `packages/app/src/routes/_authenticated/_dashboard/runs/`)

## Steps to reproduce
1. Open a run in Everr
2. Want to see the GitHub Action or PR — no link available
3. Have to manually navigate to GitHub and find the action/PR

## Expected
Clickable links to the GitHub Action run page and the associated PR directly from Everr.

## Actual
No links exist. Users must manually search GitHub.

## Priority
medium

## Notes
- GitHub Action URL pattern: `https://github.com/{org}/{repo}/actions/runs/{run_id}`
- PR URL pattern: `https://github.com/{org}/{repo}/pull/{pr_number}`
- Data likely already available in webhook payloads stored in `workflow_runs`
