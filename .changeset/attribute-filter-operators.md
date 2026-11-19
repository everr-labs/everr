---
"@everr/app": minor
"@everr/cli": minor
---

Attribute filters on Logs, Traces and Errors (and in the local UI of `everr local`) have more operators. Besides is, is not, exists and missing, a filter can now check that a value contains or does not contain some text (ignoring case), matches a regular expression, or is greater than, at least, less than or at most a number, for example `http.response.status_code` at least `500`. Pick the operator from the menu in the filter, then type the value and press Enter. A value that is not a number does not filter a number comparison.
