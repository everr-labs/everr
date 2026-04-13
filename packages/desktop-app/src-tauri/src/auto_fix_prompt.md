Investigate and fix this CI pipeline failure.

Failure details:
- {{failure_details}}

Step 1 — Pull logs:
  {{logs_instruction}}

Step 2:
- Read the logs and identify the error.
- Check if any of this branch's changes could have caused the failure.
- If the failure looks unrelated to the branch changes, check for flakiness using everr CLI

Step 3:
- if it looks flaky and doesn't come from this branch, explain the issue and ask me if we should proceed with a more in-depth analysis
- if it looks like it will cost many tokens to fix it,  explain the issue and ask me if we should proceed with the fix
- otherwise, fix the problem and run the narrowest relevant test or check before finishing.

Return a concise summary: root cause, whether it's a flaky test or a real regression, code changes (if any), verification, and any follow-up risk.
