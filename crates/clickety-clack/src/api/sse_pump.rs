use crate::domain::Event;
use crate::queue::{EventBus, TailCursor};
use std::sync::Arc;
use tokio::sync::broadcast;

/// Background task: tail the event stream and rebroadcast every event into the local
/// `events_tx`, so SSE clients on THIS api replica see events regardless of which
/// process produced them. Runs until `shutdown` flips true. Fan-out (no consumer
/// group): each api replica independently tails from the live tail.
pub async fn run_sse_pump(
    bus: Arc<dyn EventBus>,
    events_tx: broadcast::Sender<Event>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    let mut cursor = TailCursor::Live; // only events from now on
    loop {
        if *shutdown.borrow() {
            break;
        }
        let entries = match bus.tail(&cursor, 64, 1000).await {
            Ok(e) => e,
            Err(e) => {
                tracing::error!(error = %e, "sse pump tail failed");
                tokio::select! {
                    _ = tokio::time::sleep(std::time::Duration::from_millis(500)) => {}
                    _ = shutdown.changed() => {}
                }
                continue;
            }
        };
        for entry in entries {
            cursor = TailCursor::After(entry.id.clone());
            // Ignore send error: no SSE subscribers currently connected is fine.
            let _ = events_tx.send(entry.event);
        }
    }
    tracing::info!("sse pump stopped");
}
