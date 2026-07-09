use crate::dispatcher::notify::Notifier;
use crate::otel::EngineMetrics;
use std::collections::HashMap;
use std::sync::Arc;

/// Registry of channel notifiers keyed by `Notifier::channel()`. Built once at
/// startup; the dispatcher looks up the notifier for each receiver's channel.
/// Also carries the engine-metrics handle (disabled by default) so every delivery
/// path that reaches a notifier records `cc.notify.deliveries`.
#[derive(Default)]
pub struct Notifiers {
    by_channel: HashMap<String, Arc<dyn Notifier>>,
    metrics: EngineMetrics,
}

impl Notifiers {
    pub fn new() -> Self {
        Self::default()
    }

    /// Attach the engine-metrics handle (builder-style, before registration in `main`).
    pub fn with_engine_metrics(mut self, metrics: EngineMetrics) -> Self {
        self.metrics = metrics;
        self
    }

    pub fn register(&mut self, notifier: Arc<dyn Notifier>) {
        self.by_channel
            .insert(notifier.channel().to_string(), notifier);
    }

    pub fn get(&self, channel: &str) -> Option<&Arc<dyn Notifier>> {
        self.by_channel.get(channel)
    }

    /// The engine-metrics handle carried by this registry.
    pub fn engine_metrics(&self) -> &EngineMetrics {
        &self.metrics
    }
}
