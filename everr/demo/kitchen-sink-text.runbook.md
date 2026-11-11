# Text and lists

Back to the [index](./kitchen-sink.runbook.md), or on to [panels](panels).

## Inline formatting

Plain text, _italic_, _also italic_, **bold**, **also bold**, _**bold italic**_, ~~strikethrough~~, `inline code`, **bold with `code` inside**, and _italic with a [link](https://everr.dev)_.

A paragraph long enough to wrap, so line height and measure can be judged: when the error budget for checkout drops below its threshold, page the on-call engineer, open the incident channel, and start from the triage page of this runbook before touching any deploys, because rolling back blindly has caused two longer outages this year.

Emoji as text: ✅ ⚠️ 🔥 🚀

## Lists

Unordered:

- First item
- Second item, with a long line that wraps onto the next line so the hanging indent can be checked against the bullet
  - Nested item
    - Deeper nested item
- Third item

Ordered:

1. Check the dashboards
2. Read the recent deploys
   1. Nested ordered item
   2. Another one
3. Roll back if needed

Ordered, starting at 7:

7. Seventh
8. Eighth

Loose list, with paragraphs inside items:

- An item with a paragraph.

  A second paragraph in the same item.

- An item with a code block:

  ```bash
  kubectl rollout undo deployment/checkout-api
  ```

Mixed:

1. Ordered parent
   - Unordered child
   - Another child
2. Second parent

## Task lists

- [x] Acknowledge the page
- [x] Open the incident channel
- [ ] Find the bad deploy
  - [ ] Nested task
- [ ] Write the postmortem

## Callouts

> [!NOTE]
> The checkout service retries upstream calls three times before failing.

> [!TIP]
> Filter the logs by `trace_id` to follow one request across services.

> [!IMPORTANT]
> Page the payments on-call before touching the payments database.

> [!WARNING]
> Drain the node before restarting it, or in-flight requests fail.

> [!CAUTION]
> `kubectl delete namespace` cannot be undone.

## Blockquotes

> A blockquote with **formatting** and `code`.
>
> A second paragraph in it.
>
> > A nested blockquote.
>
> - A list inside a quote
> - Another item

## Tables

| Left aligned | Centered | Right aligned | Default                   |
| :----------- | :------: | ------------: | ------------------------- |
| checkout-api |  Error   |      412.5 ms | `5xx`                     |
| payments     |    Ok    |       38.2 ms | **fine**                  |
| search       |  Unset   |    1,204.0 ms | [link](https://everr.dev) |

A wide table, to see how it overflows:

| Service      | Region    | Owner         |   p50 |    p95 |    p99 | Error rate |  Requests | Last deploy      | Runbook          | Notes                         |
| ------------ | --------- | ------------- | ----: | -----: | -----: | ---------: | --------: | ---------------- | ---------------- | ----------------------------- |
| checkout-api | eu-west-1 | payments-team | 38 ms | 412 ms |  1.2 s |       2.4% | 1,204,332 | 2026-11-09 14:02 | [panels](panels) | Retries upstream on 503       |
| search       | us-east-1 | discovery     | 12 ms |  88 ms | 240 ms |       0.1% | 8,331,020 | 2026-11-08 09:40 | [panels](panels) | Cache hit rate drops at night |

## Footnotes

Error budgets are measured over 28 days[^budget], and latency at the 95th percentile[^p95].

[^budget]: Rolling, not calendar, so the budget never resets all at once.

[^p95]: The slowest 5% of requests are excluded.
