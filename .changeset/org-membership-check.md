---
"@everr/app": patch
---

`everr apply` with a logged-in session and the live event stream now check that you are still a member of your active organization. If you were removed from it, they answer `403 Forbidden` instead of acting on that organization.
