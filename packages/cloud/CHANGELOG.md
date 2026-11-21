# @everr/app-cloud

## 0.12.0

### Patch Changes

- 429aa0f: Changing a filter, an aggregation, a dashboard variable, or the time range now starts loading the new data right away. Moving between pages also waits on fewer requests, because Everr no longer checks your session, workspace, and access again on every click.

  If your session ends while a page is open (you sign out in another tab, it expires, or it is revoked), the next request now takes you to sign-in right away, and back to the same page after you sign in, instead of failing after several retries. If you lose access to the active workspace, you are sent to choose another one, and if you lose the Owner or Admin role, admin pages show that you are not authorized. When you sign out, sign in again, or switch organization in another tab or window, an open page follows the change on its next request or when you come back to it, and never shows or changes the previous organization's data. A promotion to Owner or Admin, or a restored subscription, takes effect on the next page you open, without a reload.

  When an organization's Pro subscription is suspended, only billing stays available until it is restored: Everr pages, the CLI, `everr apply`, connecting GitHub, the live event stream, and the MCP `query` tool answer that the organization is suspended. An open page now moves to the suspended subscription page on its next request, instead of only on the next navigation.

- Updated dependencies [f1c87ff]
- Updated dependencies [2433592]
- Updated dependencies [429aa0f]
- Updated dependencies [a05bb7d]
- Updated dependencies [45eb6fb]
- Updated dependencies [ea3c434]
- Updated dependencies [429aa0f]
- Updated dependencies [04315d5]
- Updated dependencies [dcfa61c]
- Updated dependencies [0ef2b13]
- Updated dependencies [0dca9db]
- Updated dependencies [adfca0c]
  - @everr/app@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [33fe03c]
  - @everr/app@0.11.0
