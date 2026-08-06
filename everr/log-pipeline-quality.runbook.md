# Log pipeline quality runbook

The **log-pipeline-quality** SLO promises that **99.5%** of log records across
the fleet over a rolling **7 days** sit below ERROR severity
(`SeverityNumber < 17`).

A 99.5% target leaves a 0.5% budget. When error-or-worse records exceed that
share, the fleet is spending; well above it, the budget is gone and stays gone
until the offending records age out of the 7-day window.

Two things worth knowing before you start:

- **This SLI measures what services say about themselves.** It burns when a
  service starts logging errors, which is usually a real fault, but a noisy new
  log line at ERROR that should have been WARN burns it just as fast.
- **Budget is fleet-wide.** High-volume services contribute more to the ratio.
  If every service needs an independent objective, define a separate SLO for
  each service. The panels below still break the fleet result down by service
  so you can find the source of a burn.

## 1. Which service, and is it still happening

```panel
ref: error-rate-by-service
```

- **A step that starts and stays** points at a deploy or a config change.
  Compare the start against release history.
- **A spike that has already come down** means the budget is spent but the
  cause is over. The alert can keep firing on its longer windows while current
  traffic is clean, because the burn is still inside the window.
- **A slow, steady climb** is the expensive one. It spends the whole budget
  without ever looking dramatic on any single window.

## 2. Rate or volume

```panel
ref: error-volume-by-service
```

The SLI is a ratio, so it moves for two different reasons and they need
different responses.

| Rate | Volume | Reading |
| --- | --- | --- |
| Up | Up | A genuine fault, getting worse |
| Up | Flat or down | Total traffic fell, so the same errors are now a bigger share. Check whether the service is still serving |
| Flat | Up | Errors and traffic growing together. Scaling, not a regression |

A service that goes quiet is the trap here: the ratio can hit 100% because the
only records still arriving are the errors.

## 3. What the errors actually are

```panel
ref: top-error-shapes
```

Bodies are grouped with digits and hex ids masked, so one failure appearing a
thousand times with a thousand different ids collapses to a single row. Read
`first_seen` against the shape of the curve above: a row whose `first_seen`
lines up with the step is almost certainly the cause.

Ask of the top row:

- Is this an error at all, or a warning logged at the wrong level? If the
  latter, fix the log level. That is a real fix, not a workaround: the SLI
  measures severity, so mis-severity is a defect in the signal.
- Is it one caller, one endpoint, one dependency?
- Does it correlate with a deploy?

## 4. The individual records

```panel
ref: recent-errors
```

Where a record carries a trace id, open the trace: it shows the request that
produced the error and everything else that request touched. Records without a
trace id are usually emitted outside a request (startup, background jobs,
scheduled work), which is itself a useful hint about where to look.

## 5. Common causes and what to do

| Signal | Likely cause | Action |
| --- | --- | --- |
| One service, step change after a release | Regression in that release | Correlate with deploy history, roll back |
| One service, ratio at or near 100%, low volume | The service stopped serving and only errors remain | Check liveness before chasing the error text |
| Many services at once | A shared dependency, or the collector itself | Look at what they have in common, not at each service |
| High rate, one repeated shape | A single failing path | Fix the path, or downgrade the level if it is not an error |
| Steady low burn, no obvious spike | Chronic noise at ERROR | Audit the log levels; this is the case that quietly drains a 7-day budget |

## 6. If the budget is already exhausted

An exhausted budget cannot be won back by fixing the cause. The window is
rolling, so the spent budget only recovers as the offending records pass out of
the trailing 7 days. Stop the burn first, then expect the budget to refill over
the remainder of the window rather than immediately.
