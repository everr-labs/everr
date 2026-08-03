# How to suppress alerts with silences and inhibitions

Two mechanisms stop notifications you don't want. They are different tools:

- **Silence**: "mute anything matching these labels during this time window."
  Time-boxed, label-based, operator-driven.
- **Inhibition**: "while *this* alert is firing, mute *that* related alert."
  Condition-based, automatic, dependency-driven.

Both run at **ingest** in the dispatcher, before routing/grouping, and both
suppress firing *and* resolved events. See
[the dispatch pipeline](../explanation/dispatch-pipeline.md) for where they sit.

> **Not what you want?** To stop a rule from *evaluating* at all (not just mute its
> notifications), [pause the rule](write-alert-rules.md#pause-a-rule) instead: a
> silence keeps the rule evaluating and only suppresses delivery.

## Silences

### Create one

```bash
curl -s -X POST localhost:8080/v1/silences -H "X-CC-Tenant: $TENANT" \
  -H 'Content-Type: application/json' \
  -d '{
    "matchers": [{ "label": "host", "op": "eq", "value": "web-1" }],
    "starts_at": "2026-06-14T22:00:00Z",
    "ends_at":   "2026-06-14T23:00:00Z",
    "comment":   "rolling restart",
    "author":    "alice"
  }'
```

- `matchers` use the standard [matcher](../reference/data-model.md#matcher)
  semantics (AND, missing-label-is-empty, `eq`/`ne`/`regex`/`notregex`). They
  match user labels and the synthetic `severity`/`status`/`rule`.
- Active when `starts_at <= now < ends_at` (`ends_at` must be after `starts_at`).
- At least one matcher is required: an empty `matchers` list is rejected with
  `422`, so a tenant-wide mute cannot be expressed as a single silence.

### Manage

```bash
curl -s localhost:8080/v1/silences -H "X-CC-Tenant: $TENANT" | jq   # list
curl -s -X DELETE localhost:8080/v1/silences/$ID -H "X-CC-Tenant: $TENANT"
```

Expired silences are garbage-collected automatically ~24h after `ends_at`, so the
table doesn't grow unbounded. Deleting early just removes them sooner.

### Important caveats

- **Applied at ingest and re-checked at flush.** Events are filtered as they
  arrive at the dispatcher, and every group flush re-applies the then-active
  silences to its buffered events. An event buffered *before* you created the
  silence is therefore still suppressed (with an audit record), as long as the
  silence is active when the group flushes.
- **Propagation lag.** Each dispatcher replica caches active silences for ~2
  seconds, so a brand-new silence can take up to that long to take effect.

## Inhibitions

Inhibition expresses dependencies: "if the whole cluster is down (critical), don't
also page me about individual services in it (warning)."

### Create one

```bash
curl -s -X POST localhost:8080/v1/inhibitions -H "X-CC-Tenant: $TENANT" \
  -H 'Content-Type: application/json' \
  -d '{
    "source_matchers": [{ "label": "severity", "op": "eq", "value": "critical" }],
    "target_matchers": [{ "label": "severity", "op": "eq", "value": "warning" }],
    "equal": ["cluster"]
  }'
```

This reads: *while a `critical` alert is firing, suppress any `warning` alert that
shares the same `cluster` label value.*

### How matching works exactly

An incoming event is **inhibited** when **all** hold:

1. it matches `target_matchers`, **and**
2. some **firing** instance (not itself) matches `source_matchers`, **and**
3. that firing source has the **same value** for every label in `equal` (if either
   side is missing an `equal` label, it does not inhibit), **and**
4. the event itself does **not** match `source_matchers` (a source can't be
   inhibited: the self-inhibition guard).

Notes:

- The source must be **firing** (the dispatcher tracks the per-tenant firing set).
  A merely pending or resolved source does not inhibit.
- `equal` is what scopes inhibition to "the same thing." Omit it and a single
  critical anywhere suppresses *all* matching warnings tenant-wide: usually not
  what you want.
- Like silences, inhibition is evaluated at ingest and again at flush, with
  the ~2s tenant cache.

### Manage

```bash
curl -s localhost:8080/v1/inhibitions -H "X-CC-Tenant: $TENANT" | jq
curl -s -X DELETE localhost:8080/v1/inhibitions/$ID -H "X-CC-Tenant: $TENANT"
```

## Silence or inhibition: which?

| You want to…                                                   | Use |
| -------------------------------------------------------------- | --- |
| Mute alerts during a planned maintenance window                | Silence |
| Mute a known-noisy alert temporarily                           | Silence |
| Stop downstream alerts when an upstream dependency is down      | Inhibition |
| Suppress low-severity noise while a high-severity issue is active | Inhibition |

## Next

- The exact pipeline position and trade-offs:
  [dispatch pipeline](../explanation/dispatch-pipeline.md).
- Field-level reference:
  [Silence](../reference/data-model.md#silence) /
  [InhibitionRule](../reference/data-model.md#inhibitionrule).
