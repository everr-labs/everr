# Remove light theme from the app

## What
Remove the light theme entirely so we only ship a dark theme.

## Where
App-wide theming / CSS / theme provider

## Steps to reproduce
N/A

## Expected
Only the dark theme should exist — no theme toggle, no light color set.

## Actual
Both light and dark themes are available, splitting effort across two color sets.

## Priority
medium

## Notes
- Removing the light theme lets us focus on polishing one cohesive dark color palette instead of maintaining two
- Should remove: theme toggle UI, light theme CSS variables/tokens, any light-specific overrides
