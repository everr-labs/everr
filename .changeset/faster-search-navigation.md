---
"@everr/app": patch
"@everr/app-cloud": patch
---

Changing a filter, an aggregation, a dashboard variable, or the time range now starts loading the new data right away. Moving between pages also waits on fewer requests, because Everr no longer checks your session, workspace, and access again on every click.

If your session ends while a page is open (you sign out in another tab, it expires, or it is revoked), the next request now takes you to sign-in right away, and back to the same page after you sign in, instead of failing after several retries. If you lose access to the active workspace, you are sent to choose another one, and if you lose the Owner or Admin role, admin pages show that you are not authorized. When you come back to a tab after signing out, signing in again, or switching organization in another tab, that tab follows the change instead of showing the previous organization's pages.

When an organization's Pro subscription is suspended, only billing stays available until it is restored: Everr pages, the CLI, `everr apply`, connecting GitHub, the live event stream, and the MCP `query` tool answer that the organization is suspended. An open page now moves to the suspended subscription page on its next request, instead of only on the next navigation.
