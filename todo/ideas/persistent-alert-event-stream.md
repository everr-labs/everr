# Persistent alert event stream

## What
Provide an Organization-wide stream of every firing and resolved alert transition for external automation, storage, or custom routing. The stream is independent of notification routes and remains active whether the Organization has zero, one, or many routes.

This is a distinct capability rather than a notification fallback. It must not stop or change behavior when a notification route is created.

## Why
Notification delivery and event export solve different problems:

- Routes deliver actionable, grouped notifications to people and team channels.
- An alert event stream exports every transition to another system without deciding who should be notified.

Treating event export as a no-route fallback created two competing delivery models, made adding a route change unrelated webhook behavior, and encouraged users to configure a less capable substitute for a catch-all route.

## Required semantics

- Operates alongside routes rather than falling back from them.
- Exports every firing and resolved transition independently of route matches.
- Has explicit delivery, retry, ordering, and replay guarantees.
- Exposes stable event identity and schema versioning for consumers.
- Reports health, lag, and delivery failures without presenting them as notification coverage.
- Keeps suppression semantics explicit: decide whether preview, silenced, and inhibited transitions are exported, and represent that decision in the event payload.

## Product shape

Present this as an integration or event-stream destination, separate from Channels, Receivers, and Routes. Do not use its presence to claim that alerts have a notification delivery path.

Existing notification use cases should use a webhook Channel in a Receiver targeted by a catch-all Route.
