---
What: Collapsed sidebar group items don't open their flyout submenu on keyboard focus
Where: packages/app/src/components/nav-main.tsx (NavItemFlyout) — uses DropdownMenu from packages/ui/src/components/dropdown-menu.tsx (base-ui Menu)
Priority: low
---

## What

When the sidebar is in icon-only (collapsed) mode, tabbing to a group item does not open its flyout submenu. The user must press Enter / Space / ArrowDown to open it. Hover-open works (`openOnHover` with 80ms delay).

## Steps to reproduce

1. Collapse the sidebar (icon-only mode).
2. Keyboard-tab onto a nav group (one that has subitems).
3. Observe that the flyout does not appear until Enter/Space/↓ is pressed.

## Expected

Flyout opens automatically when the trigger receives keyboard focus, so keyboard users see the subitems without an extra keystroke.

## Actual

Flyout stays closed on focus; only hover or explicit activation opens it.

## Notes

- base-ui `Menu.Trigger` exposes `openOnHover` but no `openOnFocus`.
- A workable implementation: controlled `open` state + `onFocus` handler, with a guard using `event.relatedTarget?.closest('[data-slot="dropdown-menu-content"]')` to prevent reopening when Escape returns focus to the trigger.
- Rejected once as too much custom handling — revisit if keyboard UX feedback pushes for it.
