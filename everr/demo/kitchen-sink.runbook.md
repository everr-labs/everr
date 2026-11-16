# Kitchen sink

Every markdown feature a runbook renders, so each one can be checked at a glance. This index page covers headings, links and code. The other pages cover [text and lists](text), [panels](panels) and a [nested page](panels/nested).

## Headings

# Heading 1

## Heading 2

### Heading 3

#### Heading 4

##### Heading 5

###### Heading 6

Setext heading 1
================

Setext heading 2
----------------

## Links

- An external link: [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/), opens in a new tab.
- A link with a title: [Everr](https://everr.dev "Hover me for the title").
- A bare URL, autolinked: https://github.com/everr-labs/everr
- An angle-bracket autolink: <https://example.com> and an email: <oncall@example.com>
- A page of this runbook by path: [Text and lists](text).
- A page by relative markdown file: [Panels](./kitchen-sink-panels.runbook.md).
- A heading on another page: [the tables section](text#tables).
- A heading on this page: [jump to code](#code).
- A reference-style link: [the CommonMark spec][commonmark].
- An app-relative link: [the dashboards list](/dashboards).

[commonmark]: https://spec.commonmark.org/ "CommonMark"

## Images

![The Everr logo](/logo.svg "An image with a title")

An image inside a link: [![Logo as a link](/logo.svg)](https://everr.dev)

## Code

Inline `code`, and a ``code span with a ` backtick``.

```sql
-- The ten busiest services in the selected range.
SELECT ServiceName, count() AS spans
FROM traces
WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
GROUP BY ServiceName
ORDER BY spans DESC
LIMIT 10
```

```bash
# Preview, then publish.
everr apply ./everr --preview
everr apply ./everr
```

```yaml
kind: Runbook # a comment
metadata: { name: demo-kitchen-sink, project: demo }
spec:
  duration: 24h
  refresh: false
  retries: 3
```

```ts
// A TypeScript fence.
export function errorRate(errors: number, total: number): number {
  return total === 0 ? 0 : (errors / total) * 100;
}
```

```json
{ "service": "checkout-api", "p95_ms": 412.5, "healthy": false }
```

A language outside the common set, loaded on first use:

```rust
// Retries with exponential backoff.
fn backoff(attempt: u32) -> std::time::Duration {
    std::time::Duration::from_millis(100 * 2u64.pow(attempt))
}
```

```dockerfile
FROM node:24-alpine
COPY . /app
RUN pnpm install --frozen-lockfile
```

```cs
// An alias: `cs` is C#.
var retries = Environment.GetEnvironmentVariable("RETRIES") ?? "3";
```

```
A fence with no language.
    Indentation is kept.
```

    An indented code block,
    four spaces in.

A very long line in a code block, to see how it overflows:

```
2026-11-09T19:41:59.123Z ERROR checkout-api request failed: upstream payments returned 503 Service Unavailable after 3 retries (trace_id=4bf92f3577b34da6a3ce929d0e0e4736 span_id=00f067aa0ba902b7)
```

## Code block options

A title in place of the language, and marked lines:

```yaml title="values.yaml" {3,5-6}
replicaCount: 3
image:
  tag: "1.42.0"
resources:
  limits: { cpu: 500m, memory: 512Mi }
  requests: { cpu: 250m, memory: 256Mi }
```

A shell session: copying it takes the commands alone, without the prompts or the output.

```console
$ kubectl get pods -l app=checkout-api
NAME                            READY   STATUS    RESTARTS
checkout-api-7d9f8b6c5d-x2k4p   1/1     Running   0
$ kubectl logs checkout-api-7d9f8b6c5d-x2k4p --tail=50
```

## Breaks and rules

A line ending in two spaces  
breaks here, and one ending in a backslash\
breaks here too. A single newline
does not.

Three rules, written three ways:

---

---

---

## Raw HTML

A few bare tags render: <kbd>Ctrl</kbd> + <kbd>C</kbd>, <mark>marked text</mark>, H<sub>2</sub>O and x<sup>2</sup>. Any other HTML shows as written: <b>not bold</b>, <script>alert(1)</script>.

<details>
<summary>Rollback script (click to expand)</summary>

Collapsed by default, for reference material that would crowd the page.

```bash
kubectl rollout undo deployment/checkout-api
```

</details>

## Escapes

\*not italic\*, \`not code\`, \# not a heading, 1\. not a list, and a literal \\ backslash.
